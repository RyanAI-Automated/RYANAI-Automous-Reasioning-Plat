import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationReport, parseArgs } from './activate-apis.mjs';

test('defaults to read-only preflight', () => {
  assert.deepEqual(parseArgs([]), { command: 'preflight', flags: new Set() });
});

test('rejects unknown commands', () => {
  assert.throws(() => parseArgs(['activate-all']), /must be preflight/);
});

test('does not count placeholders or short MCP tokens as configured', () => {
  const report = configurationReport({
    DB_PASSWORD: 'replace_with_secret',
    REDIS_PASSWORD: 'real-redis-secret',
    JWT_SECRET: 'real-jwt-secret',
    MCP_AUTH_TOKEN: 'too-short',
  });
  assert.equal(report.core.status, 'blocked');
  assert.equal(report.core.checks.DB_PASSWORD, false);
  assert.equal(report.core.checks.MCP_AUTH_TOKEN, false);
});

test('reports provider credentials as unverified, never authenticated', () => {
  const report = configurationReport({
    NVIDIA_API_KEY: 'nvidia-secret',
    QWEN_API_KEY: '',
    LOGIC_API_KEY: '',
    OPENAI_API_KEY: '',
  });
  assert.equal(report.providers.NVIDIA.status, 'configured_unverified');
  assert.equal(report.providers.QWEN.status, 'missing_credentials');
  assert.equal(report.providers.LOGIC.status, 'missing_credentials');
});

test('includes all communications channels without sending anything', () => {
  const report = configurationReport({
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'twilio-secret',
    TWILIO_WHATSAPP_NUMBER: '+15550000000',
    TWILIO_WHATSAPP_WEBHOOK_URL: 'https://example.test/whatsapp',
    RYANAI_OWNER_PHONE: '+15550000001',
    TWILIO_PHONE_NUMBER: '+15550000002',
    TWILIO_SMS_WEBHOOK_URL: 'https://example.test/sms',
    TWILIO_VOICE_WEBHOOK_URL: 'https://example.test/voice',
    TWILIO_VOICE_ACTION_URL: 'https://example.test/respond',
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'user',
    SMTP_PASS: 'password',
    SMTP_FROM: 'ryanai@example.test',
    RYANAI_OWNER_EMAIL: 'owner@example.test',
    RESEND_API_KEY: 'resend-secret',
    RESEND_WEBHOOK_SECRET: 'webhook-secret',
  });
  for (const channel of ['whatsapp', 'sms', 'voice', 'email', 'inboundEmail']) {
    assert.equal(report.communications[channel].status, 'configured_unverified');
  }
  assert.match(report.integrationsNote, /Authentication/);
});
