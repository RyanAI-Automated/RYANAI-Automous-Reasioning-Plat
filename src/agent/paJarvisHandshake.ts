import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JarvisCapability } from './jarvisRegistry.js';

export const PA_IDENTITY = 'ryanai-pa';
export const JARVIS_IDENTITY = 'ryanai-jarvis';
export const PA_DELEGATION_CAPABILITIES = [
  'repository.inspect',
  'diagnostics.run',
  'patch.propose',
  'tests.run',
  'evidence.record',
] as const satisfies readonly JarvisCapability[];

export type PADelegationCapability = (typeof PA_DELEGATION_CAPABILITIES)[number];

export interface AgentIdentityProof {
  version: 1;
  issuer: string;
  subject: string;
  audience: string;
  ownerUserId: string;
  delegationId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  capabilities: PADelegationCapability[];
}

export interface NonceConsumer {
  /** Must atomically persist/consume a nonce and reject a previously consumed value. */
  consume(nonce: string, expiresAt: Date): Promise<boolean>;
}

export class AgentHandshakeError extends Error {
  constructor(
    public readonly code: 'malformed' | 'invalid_signature' | 'invalid_identity' | 'expired' | 'future_issued' | 'invalid_scope' | 'replayed',
  ) {
    super('Agent identity handshake rejected.');
    this.name = 'AgentHandshakeError';
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

/** Sign an identity proof. Callers must supply a dedicated, high-entropy secret. */
export function signAgentIdentityProof(proof: AgentIdentityProof, secret: string): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Agent identity secret must contain at least 32 bytes.');
  const payload = encode(proof);
  return payload + '.' + signature(payload, secret).toString('base64url');
}

/**
 * Verify a short-lived PA-to-Jarvis proof. Replay protection is delegated to an
 * atomic durable nonce store; a process-local cache is deliberately insufficient.
 */
export async function verifyPAIdentityProof(
  token: string,
  secret: string,
  nonceConsumer: NonceConsumer,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AgentIdentityProof> {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new AgentHandshakeError('invalid_signature');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AgentHandshakeError('malformed');

  const [payload, suppliedText] = parts;
  let supplied: Buffer;
  let proof: AgentIdentityProof;
  try {
    supplied = Buffer.from(suppliedText, 'base64url');
    proof = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentIdentityProof;
  } catch {
    throw new AgentHandshakeError('malformed');
  }

  const expected = signature(payload, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new AgentHandshakeError('invalid_signature');
  }

  if (
    proof?.version !== 1 ||
    proof.issuer !== PA_IDENTITY ||
    proof.subject !== PA_IDENTITY ||
    proof.audience !== JARVIS_IDENTITY ||
    typeof proof.ownerUserId !== 'string' || !proof.ownerUserId.trim() ||
    typeof proof.delegationId !== 'string' || !proof.delegationId.trim() ||
    typeof proof.nonce !== 'string' || proof.nonce.length < 16 ||
    !Number.isInteger(proof.issuedAt) ||
    !Number.isInteger(proof.expiresAt)
  ) {
    throw new AgentHandshakeError('invalid_identity');
  }

  if (proof.issuedAt > nowSeconds + 30) throw new AgentHandshakeError('future_issued');
  if (proof.expiresAt <= nowSeconds || proof.expiresAt <= proof.issuedAt || proof.expiresAt - proof.issuedAt > 120) {
    throw new AgentHandshakeError('expired');
  }

  if (
    !Array.isArray(proof.capabilities) ||
    proof.capabilities.length === 0 ||
    proof.capabilities.some((capability) => !PA_DELEGATION_CAPABILITIES.includes(capability))
  ) {
    throw new AgentHandshakeError('invalid_scope');
  }

  const consumed = await nonceConsumer.consume(proof.nonce, new Date(proof.expiresAt * 1000));
  if (!consumed) throw new AgentHandshakeError('replayed');
  return proof;
}
