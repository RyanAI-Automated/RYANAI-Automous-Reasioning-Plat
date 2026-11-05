import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJson,
  createFsyncAuditStore,
  evaluateGenXApprovalBoundary
} from './benchmark-genx-approval-contract.mjs';

const now = Date.parse('2026-11-05T10:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const event = {
  agentId: 'benchmark-fixture-agent',
  principal: 'benchmark-fixture-requester',
  toolName: 'system_diagnostics',
  action: 'UPDATE',
  target: 'synthetic/local-fixture'
};

function makeService(pair, options = {}) {
  let cachedReceipt;
  return async request => {
    if (options.throw) throw new Error('synthetic approval-service unavailable');
    if (options.replay && cachedReceipt) return cachedReceipt;
    const issuedAt = new Date(now - 10_000).toISOString();
    const expiresAt = new Date(now + (options.expired ? -1000 : 60_000)).toISOString();
    const payload = {
      schemaVersion: '1.0.0',
      requestId: request.requestId,
      requestSha256: options.mismatchRequest ? 'f'.repeat(64) : request.requestSha256,
      servicePrincipal: options.wrongService
        ? 'untrusted-approval-service'
        : 'synthetic-approval-service',
      requestAuthenticated: options.unauthenticated !== true,
      approverId: options.sameApprover ? event.principal : 'synthetic-independent-admin',
      approved: options.rejected !== true,
      issuedAt,
      expiresAt,
      nonce: options.nonce ?? 'synthetic-one-time-nonce-0001',
      keyId: hash(pair.publicKey.export({ type: 'spki', format: 'der' })),
      algorithm: 'Ed25519'
    };
    let signature = sign(null, Buffer.from(canonicalJson(payload)), pair.privateKey).toString('base64');
    if (options.tamperSignature) signature = 'A'.repeat(signature.length);
    cachedReceipt = { ...payload, signature };
    return cachedReceipt;
  };
}

async function fixture(options = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ryanai-genx-approval-'));
  const journalPath = path.join(temp, 'audit', 'authorization.jsonl');
  await mkdir(path.dirname(journalPath));
  const keyPair = generateKeyPairSync('ed25519');
  const auditStore = await createFsyncAuditStore(journalPath);
  const approvalService = makeService(keyPair, options);
  return {
    temp,
    journalPath,
    keyPair,
    auditStore,
    deps: {
      now: () => now,
      requestId: options.requestId ?? 'synthetic-request-0001',
      approvalService,
      approvalServicePublicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
      approvalServiceKeySha256: hash(keyPair.publicKey.export({ type: 'spki', format: 'der' })),
      expectedServicePrincipal: 'synthetic-approval-service',
      auditStore
    }
  };
}

test('authenticated approval is request-bound, one-time and durably audited before ALLOW', async () => {
  const f = await fixture();
  try {
    const result = await evaluateGenXApprovalBoundary(event, f.deps);
    assert.equal(result.policyDecision, 'REQUIRE_APPROVAL');
    assert.equal(result.decision, 'ALLOW');
    assert.equal(result.approvalStatus, 'APPROVED');
    assert.equal(result.auditPersisted, true);
    assert.equal(result.gateVerdict, 'BLOCKED');
    assert.equal(result.modelInvocation, false);

    const reopened = await createFsyncAuditStore(f.journalPath);
    const journal = await reopened.verify();
    assert.equal(journal.valid, true);
    assert.equal(journal.entryCount, 2);
    assert.equal(journal.nonceCount, 1);
    assert.equal(journal.auditCount, 1);
    const audit = journal.entries.find(item => item.type === 'authorization.audit');
    assert.equal(audit.finalDecision, 'ALLOW');
    assert.equal(audit.approvalStatus, 'APPROVED');
    assert.equal(audit.approverId, 'synthetic-independent-admin');
    assert.equal(audit.target, undefined, 'audit must not retain raw target strings');
    assert.equal(typeof audit.targetSha256, 'string');
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('approval-service outage fails closed and the denial is durably audited', async () => {
  const f = await fixture({ throw: true });
  try {
    const result = await evaluateGenXApprovalBoundary(event, f.deps);
    assert.equal(result.decision, 'DENY');
    assert.equal(result.approvalStatus, 'SERVICE_UNAVAILABLE_OR_INVALID');
    assert.equal(result.auditPersisted, true);
    const journal = await f.auditStore.verify();
    const audit = journal.entries.find(item => item.type === 'authorization.audit');
    assert.equal(audit.finalDecision, 'DENY');
    assert.equal(audit.reasonCode, 'GX-APPROVAL-FAIL-CLOSED');
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('forged, unauthenticated, wrong-service, expired and requester-self-approved receipts deny', async () => {
  for (const options of [
    { tamperSignature: true },
    { unauthenticated: true },
    { wrongService: true },
    { expired: true },
    { mismatchRequest: true },
    { sameApprover: true },
    { missingSignerPin: true }
  ]) {
    const f = await fixture(options);
    try {
      const result = await evaluateGenXApprovalBoundary(event, f.deps);
      assert.equal(result.decision, 'DENY', JSON.stringify(options));
      assert.equal(result.auditPersisted, true, JSON.stringify(options));
    } finally {
      await rm(f.temp, { recursive: true, force: true });
    }
  }
});

test('approval rejection is audited and cannot authorize the action', async () => {
  const f = await fixture({ rejected: true });
  try {
    const result = await evaluateGenXApprovalBoundary(event, f.deps);
    assert.equal(result.decision, 'DENY');
    assert.equal(result.approvalStatus, 'REJECTED');
    const journal = await f.auditStore.verify();
    assert.equal(journal.auditCount, 1);
    assert.equal(journal.entries.at(-1).finalDecision, 'DENY');
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('replayed approval nonce is denied on the second use and both decisions are audited', async () => {
  const f = await fixture({ replay: true, requestId: 'synthetic-replay-request-0001' });
  try {
    const first = await evaluateGenXApprovalBoundary(event, f.deps);
    const second = await evaluateGenXApprovalBoundary(event, f.deps);
    assert.equal(first.decision, 'ALLOW');
    assert.equal(second.decision, 'DENY');
    assert.equal(second.approvalStatus, 'REPLAYED');
    const journal = await f.auditStore.verify();
    assert.equal(journal.nonceCount, 1);
    assert.equal(journal.auditCount, 2);
    assert.deepEqual(
      journal.entries.filter(item => item.type === 'authorization.audit').map(item => item.finalDecision),
      ['ALLOW', 'DENY']
    );
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('audit persistence failure overrides an otherwise valid approval', async () => {
  const f = await fixture();
  try {
    const result = await evaluateGenXApprovalBoundary(event, {
      ...f.deps,
      auditStore: {
        consumeNonce: async () => true,
        append: async () => { throw new Error('synthetic durable audit outage'); }
      }
    });
    assert.equal(result.decision, 'DENY');
    assert.equal(result.ruleId, 'GX-AUDIT-001');
    assert.equal(result.auditPersisted, false);
    assert.equal(result.reasonCode, 'GX-AUDIT-PERSISTENCE-FAILED');
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('policy ALLOW and policy DENY both require durable audit append', async () => {
  const f = await fixture();
  try {
    const safeRead = {
      agentId: event.agentId, principal: event.principal,
      toolName: 'system_diagnostics', action: 'READ'
    };
    const allowed = await evaluateGenXApprovalBoundary(safeRead, f.deps);
    assert.equal(allowed.decision, 'ALLOW');
    const denied = await evaluateGenXApprovalBoundary({
      ...safeRead, toolName: 'execute_shell_command', action: 'EXECUTE'
    }, f.deps);
    assert.equal(denied.decision, 'DENY');
    const journal = await f.auditStore.verify();
    assert.equal(journal.auditCount, 2);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('tampered or truncated audit journal fails integrity verification', async () => {
  const f = await fixture();
  try {
    const result = await evaluateGenXApprovalBoundary(event, f.deps);
    assert.equal(result.auditPersisted, true);
    const original = await readFile(f.journalPath, 'utf8');
    await (await import('node:fs/promises')).writeFile(
      f.journalPath, original.replace('"finalDecision":"ALLOW"', '"finalDecision":"DENY"')
    );
    await assert.rejects(
      createFsyncAuditStore(f.journalPath),
      /hash-chain verification failed/
    );
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
