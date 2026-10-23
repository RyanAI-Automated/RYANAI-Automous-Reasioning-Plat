import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatchService, type PipelineReportPayload } from './dispatchService';

const providers = vi.hoisted(() => ({
  message: vi.fn(),
  email: vi.fn(),
  twilio: vi.fn(),
  resend: vi.fn(),
}));
vi.mock('twilio', () => ({ default: providers.twilio }));
vi.mock('resend', () => ({ Resend: providers.resend }));

const report: PipelineReportPayload = {
  projectName: 'RyanAI',
  status: 'SUCCESS',
  branch: 'main',
  commitHash: '123456789abcdef',
  author: 'Developer',
  executionTimeMs: 1250,
  logUrl: 'https://example.com/runs/1',
  transcendStatus: { evaluated: true, violationsCount: 0, violations: [] },
  codeDiffSummary: { filesChanged: 2, insertions: 8, deletions: 3 },
};

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_NUMBER',
    'DEFAULT_RECIPIENT_PHONE',
    'RESEND_API_KEY',
    'DISPATCH_FROM_EMAIL',
    'DEFAULT_RECIPIENT_EMAIL',
  ])
    vi.stubEnv(key, '');
  providers.twilio.mockImplementation(() => ({
    messages: { create: providers.message },
  }));
  providers.resend.mockImplementation(function () {
    return { emails: { send: providers.email } };
  });
  providers.message.mockResolvedValue({ sid: 'SM-test' });
  providers.email.mockResolvedValue({
    data: { id: 'email-test' },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

function configureWhatsApp() {
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC-test');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token');
  vi.stubEnv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+15555550100');
  vi.stubEnv('DEFAULT_RECIPIENT_PHONE', '+15555550101');
}
function configureEmail() {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('DISPATCH_FROM_EMAIL', 'RyanAI <sender@example.com>');
  vi.stubEnv('DEFAULT_RECIPIENT_EMAIL', 'recipient@example.com');
}

describe('DispatchService', () => {
  it('allows construction without optional provider credentials and rejects unconfigured sends', async () => {
    const dispatch = new DispatchService();
    expect(providers.twilio).not.toHaveBeenCalled();
    expect(providers.resend).not.toHaveBeenCalled();
    await expect(dispatch.sendWhatsAppPipelineUpdate(report)).rejects.toThrow(
      'TWILIO_ACCOUNT_SID',
    );
    await expect(dispatch.sendPipelineEmailReport(report)).rejects.toThrow(
      'RESEND_API_KEY',
    );
    expect(providers.message).not.toHaveBeenCalled();
    expect(providers.email).not.toHaveBeenCalled();
  });

  it('uses configuration loaded after construction and normalizes WhatsApp addresses', async () => {
    const dispatch = new DispatchService();
    configureWhatsApp();
    await expect(dispatch.sendWhatsAppPipelineUpdate(report)).resolves.toBe(
      'SM-test',
    );
    expect(providers.twilio).toHaveBeenCalledWith('AC-test', 'test-token');
    expect(providers.message).toHaveBeenCalledWith({
      from: 'whatsapp:+15555550100',
      to: 'whatsapp:+15555550101',
      body: expect.stringContaining('*Duration:* 1.25s'),
    });
  });

  it('dispatches security details to an explicit recipient without a default', async () => {
    configureWhatsApp();
    vi.stubEnv('DEFAULT_RECIPIENT_PHONE', '');
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+15555550100');
    await expect(
      new DispatchService().sendWhatsAppSecurityAlert(
        {
          pid: 123,
          command: 'blocked command',
          actionTaken: 'BLOCKED',
          timestamp: '2026-10-06T00:00:00Z',
          violations: ['policy violation'],
        },
        'whatsapp:+15555550102',
      ),
    ).resolves.toBe('SM-test');
    expect(providers.message).toHaveBeenCalledWith({
      from: 'whatsapp:+15555550100',
      to: 'whatsapp:+15555550102',
      body: expect.stringContaining('policy violation'),
    });
  });

  it('never falls back to a hardcoded recipient', async () => {
    configureWhatsApp();
    configureEmail();
    vi.stubEnv('DEFAULT_RECIPIENT_PHONE', '');
    vi.stubEnv('DEFAULT_RECIPIENT_EMAIL', '');
    const dispatch = new DispatchService();
    await expect(dispatch.sendWhatsAppPipelineUpdate(report)).rejects.toThrow(
      'DEFAULT_RECIPIENT_PHONE',
    );
    await expect(dispatch.sendPipelineEmailReport(report)).rejects.toThrow(
      'DEFAULT_RECIPIENT_EMAIL',
    );
    expect(providers.message).not.toHaveBeenCalled();
    expect(providers.email).not.toHaveBeenCalled();
  });

  it('returns the provider email ID and escapes report content in HTML', async () => {
    configureEmail();
    await expect(
      new DispatchService().sendPipelineEmailReport({
        ...report,
        projectName: '<img src=x>',
        author: 'A & B',
        branch: '<main>',
        transcendStatus: {
          evaluated: true,
          violationsCount: 1,
          violations: ['<script>bad</script>'],
        },
      }),
    ).resolves.toBe('email-test');
    const sent = providers.email.mock.calls[0][0];
    expect(sent).toMatchObject({
      from: 'RyanAI <sender@example.com>',
      to: 'recipient@example.com',
    });
    expect(sent.html).toContain('&lt;img src=x&gt;');
    expect(sent.html).toContain('A &amp; B');
    expect(sent.html).toContain('&lt;main&gt;');
    expect(sent.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(sent.html).not.toContain('<script>bad</script>');
  });

  it('uses an explicit email recipient and rejects unsafe telemetry URL schemes', async () => {
    configureEmail();
    vi.stubEnv('DEFAULT_RECIPIENT_EMAIL', '');
    const dispatch = new DispatchService();
    await dispatch.sendPipelineEmailReport(report, 'override@example.com');
    expect(providers.email).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'override@example.com' }),
    );
    providers.email.mockClear();
    await expect(
      dispatch.sendPipelineEmailReport(
        { ...report, logUrl: 'javascript:alert(1)' },
        'override@example.com',
      ),
    ).rejects.toThrow('HTTP or HTTPS');
    expect(providers.email).not.toHaveBeenCalled();
  });

  it('does not describe unevaluated governance as passed', async () => {
    configureWhatsApp();
    configureEmail();
    const payload = {
      ...report,
      transcendStatus: { evaluated: false, violationsCount: 0, violations: [] },
    };
    const dispatch = new DispatchService();
    await dispatch.sendWhatsAppPipelineUpdate(payload);
    await dispatch.sendPipelineEmailReport(payload);
    expect(providers.message.mock.calls[0][0].body).toContain('Not evaluated');
    expect(providers.email.mock.calls[0][0].html).toContain('Not evaluated');
  });

  it('propagates delivery errors and rejects missing provider IDs', async () => {
    configureWhatsApp();
    configureEmail();
    const dispatch = new DispatchService();
    providers.message.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(dispatch.sendWhatsAppPipelineUpdate(report)).rejects.toThrow(
      'provider unavailable',
    );
    providers.message.mockResolvedValueOnce({});
    await expect(dispatch.sendWhatsAppPipelineUpdate(report)).rejects.toThrow(
      'no message SID',
    );
    providers.email.mockResolvedValueOnce({
      error: { message: 'provider denied' },
      data: null,
    });
    await expect(dispatch.sendPipelineEmailReport(report)).rejects.toThrow(
      'provider denied',
    );
    providers.email.mockResolvedValueOnce({ error: null, data: null });
    await expect(dispatch.sendPipelineEmailReport(report)).rejects.toThrow(
      'no email ID',
    );
  });
});