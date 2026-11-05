import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = await readFile(new URL('../prisma/migrations/20261106000000_security_centre_core/migration.sql', import.meta.url), 'utf8');

test('Security Centre models reuse the existing audit and engineering evidence ledgers', () => {
  for (const model of ['SecurityScan', 'SecurityFinding', 'SecurityEvidence', 'SecurityRemediation', 'SecurityApproval']) {
    assert.match(schema, new RegExp('model ' + model + ' \\{'));
  }
  assert.match(schema, /model JarvisAuditEvent \{/);
  assert.match(schema, /model AgentRunEvidence \{/);
});

test('scan environments exclude production and Kali execution requires a scoped approval', () => {
  assert.match(migration, /'isolated_ci', 'isolated_kali_lab', 'staging'/);
  assert.match(migration, /security_scans_kali_requires_approval/);
  assert.match(migration, /scope <> 'kali_lab_scan'/);
  assert.match(migration, /approval_record\.used_at IS NOT NULL/);
  assert.match(migration, /approval_record\.commit_sha IS DISTINCT FROM NEW\.commit_sha/);
  assert.doesNotMatch(migration, /'production'/);
  assert.match(migration, /ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public.%I FROM %I/);
  assert.match(migration, /GRANT ALL ON TABLE public.%I TO service_role/);
});

test('evidence is append-only and content hashes are validated', () => {
  assert.match(migration, /reject_security_evidence_mutation/);
  assert.match(migration, /security_evidence_immutable/);
  assert.match(migration, /sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
});

test('remediation records are recommendations and have no automatic apply state', () => {
  assert.match(migration, /'proposed', 'approved', 'rejected', 'verified'/);
  assert.doesNotMatch(migration, /'applied'/);
  assert.match(migration, /verification_scan_id UUID REFERENCES public\.security_scans/);
});
