import { constants } from 'node:fs';
import { open, lstat, readFile, realpath } from 'node:fs/promises';
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import path from 'node:path';
import { evaluateGenXFailClosed } from './benchmark-genx-policy-contract.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_APPROVAL_TTL_MS = 5 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 30 * 1000;

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Audit values must not contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  throw new Error('Audit values must be JSON-compatible.');
}

function digest(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

async function readJournal(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error('Audit journal path must be absolute.');
  await realpath(path.dirname(filePath));
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Audit journal must be a regular non-symlink file.');
    }
    if ((stat.mode & 0o077) !== 0) throw new Error('Audit journal permissions must be owner-only.');
    const content = await readFile(filePath, 'utf8');
    if (!content.endsWith('\n')) throw new Error('Audit journal is incomplete (missing final newline).');
    const lines = content.split('\n').filter(Boolean);
    const entries = [];
    let previousHash = null;
    for (const [index, line] of lines.entries()) {
      const entry = JSON.parse(line);
      if (entry.sequence !== index + 1 || entry.previousHash !== previousHash ||
          !entry.record || typeof entry.record !== 'object') {
        throw new Error('Audit journal sequence or hash-chain linkage is invalid.');
      }
      const expected = digest({
        sequence: entry.sequence,
        previousHash: entry.previousHash,
        record: entry.record
      });
      if (entry.entrySha256 !== expected) throw new Error('Audit journal hash-chain verification failed.');
      previousHash = entry.entrySha256;
      entries.push(entry);
    }
    return entries;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Single-process, fsync-backed append-only fixture journal.
 * This is a test adapter for persistence contracts, not a production multi-node
 * audit database. Production still needs a transactional database append and
 * a uniqueness constraint for consumed approval nonces.
 */
export async function createFsyncAuditStore(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error('Audit journal path must be absolute.');
  await realpath(path.dirname(filePath));
  let entries = await readJournal(filePath);
  let queue = Promise.resolve();
  const consumedNonces = new Set(
    entries.filter(entry => entry.record.type === 'approval.nonce_consumed')
      .map(entry => entry.record.nonceSha256)
  );

  async function appendRecord(record) {
    const sequence = entries.length + 1;
    const previousHash = entries.at(-1)?.entrySha256 ?? null;
    const entry = {
      sequence,
      previousHash,
      record,
      entrySha256: digest({ sequence, previousHash, record })
    };
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(
      filePath,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollow,
      0o600
    );
    try {
      await handle.writeFile(JSON.stringify(entry) + '\n', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    entries.push(entry);
    return entry;
  }

  const serial = work => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    async append(record) {
      return serial(async () => {
        const entry = await appendRecord({ type: 'authorization.audit', ...record });
        return {
          persisted: true,
          sequence: entry.sequence,
          recordSha256: digest(entry.record),
          journalHeadSha256: entry.entrySha256
        };
      });
    },

    async consumeNonce(nonce, receiptSha256, expiresAt) {
      return serial(async () => {
        if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 256 ||
            consumedNonces.has(sha256(Buffer.from(nonce)))) return false;
        const nonceSha256 = sha256(Buffer.from(nonce));
        await appendRecord({
          type: 'approval.nonce_consumed',
          nonceSha256,
          receiptSha256,
          expiresAt
        });
        consumedNonces.add(nonceSha256);
        return true;
      });
    },

    async verify() {
      await queue;
      const verifiedEntries = await readJournal(filePath);
      return {
        valid: true,
        entryCount: verifiedEntries.length,
        auditCount: verifiedEntries.filter(entry => entry.record.type === 'authorization.audit').length,
        nonceCount: verifiedEntries.filter(entry => entry.record.type === 'approval.nonce_consumed').length,
        headSha256: verifiedEntries.at(-1)?.entrySha256 ?? null,
        entries: verifiedEntries.map(entry => entry.record)
      };
    }
  };
}

function approvalRequestFor(event, policy, requestId, now) {
  const requestPayload = {
    schemaVersion: '1.0.0',
    requestId,
    principal: event.principal,
    agentId: event.agentId,
    toolName: event.toolName,
    action: event.action,
    targetSha256: event.target ? sha256(Buffer.from(event.target)) : null,
    commandPresent: event.command !== undefined,
    policyRuleId: policy.ruleId,
    createdAt: new Date(now).toISOString()
  };
  return { ...requestPayload, requestSha256: digest(requestPayload) };
}

function verifyApprovalReceipt(receipt, request, deps, now) {
  if (!receipt || receipt.schemaVersion !== '1.0.0' ||
      receipt.algorithm !== 'Ed25519' ||
      receipt.servicePrincipal !== deps.expectedServicePrincipal ||
      receipt.requestAuthenticated !== true ||
      receipt.requestId !== request.requestId ||
      receipt.requestSha256 !== request.requestSha256 ||
      typeof receipt.approverId !== 'string' || !receipt.approverId.trim() ||
      receipt.approverId === request.principal ||
      typeof receipt.approved !== 'boolean' ||
      typeof receipt.nonce !== 'string' || receipt.nonce.length < 16 ||
      typeof receipt.keyId !== 'string' ||
      typeof receipt.signature !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.signature)) {
    throw new Error('Approval receipt is missing authenticated, request-bound claims.');
  }
  if (typeof deps.approvalServicePublicKeyPem !== 'string' ||
      !deps.approvalServicePublicKeyPem.trim()) {
    throw new Error('Approval-service verification key is not configured.');
  }
  const publicKey = createPublicKey(deps.approvalServicePublicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Approval-service verification key must be Ed25519.');
  }
  const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (receipt.keyId !== keyId) throw new Error('Approval-service signing key fingerprint mismatch.');

  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + FUTURE_CLOCK_SKEW_MS || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > MAX_APPROVAL_TTL_MS) {
    throw new Error('Approval receipt is expired or has an invalid validity window.');
  }
  const signature = Buffer.from(receipt.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== receipt.signature) {
    throw new Error('Approval receipt signature encoding is invalid.');
  }
  const { signature: _signature, ...payload } = receipt;
  if (!verifySignature(null, Buffer.from(canonicalJson(payload)), publicKey, signature)) {
    throw new Error('Approval receipt signature verification failed.');
  }
  return {
    approverId: receipt.approverId,
    approved: receipt.approved,
    nonce: receipt.nonce,
    expiresAt: receipt.expiresAt,
    receiptSha256: digest(receipt)
  };
}

function sanitizedAuditRecord(event, policy, details) {
  return {
    schemaVersion: '1.0.0',
    occurredAt: details.occurredAt,
    requestId: details.requestId,
    agentId: event.agentId,
    principal: event.principal,
    toolName: event.toolName,
    action: event.action,
    environment: event.environment ?? null,
    targetSha256: event.target ? sha256(Buffer.from(event.target)) : null,
    commandPresent: event.command !== undefined,
    policyDecision: policy.decision,
    policyRuleId: policy.ruleId,
    approvalStatus: details.approvalStatus,
    approvalServicePrincipal: details.approvalServicePrincipal ?? null,
    approverId: details.approverId ?? null,
    approvalReceiptSha256: details.approvalReceiptSha256 ?? null,
    finalDecision: details.finalDecision,
    reasonCode: details.reasonCode
  };
}

export async function evaluateGenXApprovalBoundary(event, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const requestId = typeof deps.requestId === 'string' && deps.requestId.trim()
    ? deps.requestId : randomUUID();
  const policy = evaluateGenXFailClosed(event, deps.policyEvaluator);
  let approvalStatus = 'NOT_REQUIRED';
  let approvalServicePrincipal = null;
  let approverId = null;
  let approvalReceiptSha256 = null;
  let finalDecision = policy.decision === 'ALLOW' ? 'ALLOW' : 'DENY';
  let reasonCode = policy.ruleId;

  if (policy.decision === 'REQUIRE_APPROVAL') {
    const request = approvalRequestFor(event, policy, requestId, now);
    try {
      if (typeof deps.approvalService !== 'function') {
        throw new Error('Authenticated approval service is unavailable.');
      }
      const receipt = await deps.approvalService(request);
      const verified = verifyApprovalReceipt(receipt, request, deps, now);
      approvalServicePrincipal = receipt.servicePrincipal;
      approverId = verified.approverId;
      approvalReceiptSha256 = verified.receiptSha256;
      if (!verified.approved) {
        approvalStatus = 'REJECTED';
        reasonCode = 'GX-APPROVAL-REJECTED';
      } else {
        if (!deps.auditStore || typeof deps.auditStore.consumeNonce !== 'function') {
          throw new Error('Durable approval nonce store is unavailable.');
        }
        const consumed = await deps.auditStore.consumeNonce(
          verified.nonce, verified.receiptSha256, verified.expiresAt
        );
        if (!consumed) {
          approvalStatus = 'REPLAYED';
          reasonCode = 'GX-APPROVAL-REPLAY';
        } else {
          approvalStatus = 'APPROVED';
          finalDecision = 'ALLOW';
          reasonCode = 'GX-APPROVAL-VERIFIED';
        }
      }
    } catch {
      approvalStatus = 'SERVICE_UNAVAILABLE_OR_INVALID';
      reasonCode = 'GX-APPROVAL-FAIL-CLOSED';
      finalDecision = 'DENY';
    }
  }

  const auditRecord = sanitizedAuditRecord(event, policy, {
    occurredAt: new Date(now).toISOString(),
    requestId,
    approvalStatus,
    approvalServicePrincipal,
    approverId,
    approvalReceiptSha256,
    finalDecision,
    reasonCode
  });

  try {
    if (!deps.auditStore || typeof deps.auditStore.append !== 'function') {
      throw new Error('Durable audit store is unavailable.');
    }
    const result = await deps.auditStore.append(auditRecord);
    if (!result || result.persisted !== true ||
        !Number.isInteger(result.sequence) || result.sequence < 1 ||
        result.recordSha256 !== digest({ type: 'authorization.audit', ...auditRecord }) ||
        typeof result.journalHeadSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(result.journalHeadSha256)) {
      throw new Error('Audit store did not confirm a valid persisted record.');
    }
    return {
      decision: finalDecision,
      policyDecision: policy.decision,
      ruleId: finalDecision === 'DENY' && policy.decision !== 'DENY' ? reasonCode : policy.ruleId,
      approvalStatus,
      auditPersisted: true,
      auditSequence: result.sequence,
      auditRecordSha256: result.recordSha256,
      gateVerdict: 'BLOCKED',
      modelInvocation: false,
      reasonCode
    };
  } catch {
    return {
      decision: 'DENY',
      policyDecision: policy.decision,
      ruleId: 'GX-AUDIT-001',
      approvalStatus,
      auditPersisted: false,
      gateVerdict: 'BLOCKED',
      modelInvocation: false,
      reasonCode: 'GX-AUDIT-PERSISTENCE-FAILED'
    };
  }
}
