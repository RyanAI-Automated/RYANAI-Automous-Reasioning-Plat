import { Resend } from 'resend';
import twilio from 'twilio';

export interface PipelineReportPayload {
  projectName: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'BLOCKED';
  branch: string;
  commitHash: string;
  author: string;
  executionTimeMs: number;
  logUrl: string;
  transcendStatus: {
    evaluated: boolean;
    violationsCount: number;
    violations: string[];
  };
  codeDiffSummary?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface SecurityAlertPayload {
  pid: number;
  command: string;
  violations: string[];
  actionTaken: 'SIGKILL' | 'BLOCKED' | 'FLAGGED' | 'SUCCESS' | 'FAILED';
  timestamp: string;
}

export class DispatchService {
  // Read configuration at dispatch time so importing the service does not require
  // optional provider credentials, and failed delivery is never reported as success.
  /** Read a trimmed dispatch setting at call time; throw if missing or blank. */
  private requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Dispatch requires ${name}`);
    return value;
  }

  /**
   * Send text through Twilio and return its message SID.
   * A blank or omitted target uses DEFAULT_RECIPIENT_PHONE; addresses gain a whatsapp:
   * prefix when absent. Missing settings, provider errors, or a missing SID reject.
   */
  private async sendWhatsApp(
    body: string,
    targetPhone?: string,
  ): Promise<string> {
    const accountSid = this.requiredEnv('TWILIO_ACCOUNT_SID');
    const authToken = this.requiredEnv('TWILIO_AUTH_TOKEN');
    const from = this.requiredEnv('TWILIO_WHATSAPP_NUMBER');
    const to =
      targetPhone?.trim() || this.requiredEnv('DEFAULT_RECIPIENT_PHONE');
    const address = (phone: string) =>
      phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
    const result = await twilio(accountSid, authToken).messages.create({
      from: address(from),
      to: address(to),
      body,
    });
    if (!result.sid) throw new Error('Twilio returned no message SID');
    return result.sid;
  }

  /* ==========================================================================
     WHATSAPP DISPATCHERS
     ========================================================================== */

  /**
   * Send WhatsApp text update for pipeline completion and return the Twilio message SID.
   * payload.executionTimeMs is displayed in seconds. Blank or omitted targetPhone uses
   * DEFAULT_RECIPIENT_PHONE; configuration and delivery errors propagate.
   */
  async sendWhatsAppPipelineUpdate(
    payload: PipelineReportPayload,
    targetPhone?: string,
  ): Promise<string> {
    const statusEmoji = payload.status === 'SUCCESS' ? '✅' : '🚨';
    const durationSec = (payload.executionTimeMs / 1000).toFixed(2);

    const message = [
      `${statusEmoji} *RyanAI Pipeline ${payload.status}*`,
      `*Project:* ${payload.projectName}`,
      `*Branch:* \`${payload.branch}\` (${payload.commitHash.slice(0, 7)})`,
      `*Duration:* ${durationSec}s`,
      payload.transcendStatus.violationsCount > 0
        ? `\n⚠️ *Transcend Violations:* ${payload.transcendStatus.violationsCount}`
        : payload.transcendStatus.evaluated
          ? '🛡️ *Transcend Guard:* Passed'
          : '🛡️ *Transcend Guard:* Not evaluated',
      `\n📊 *Telemetry & Audit Logs:*\n${payload.logUrl}`,
    ].join('\n');

    return this.sendWhatsApp(message, targetPhone);
  }

  /**
   * Send urgent WhatsApp security alert for eBPF or Transcend blocks.
   * Returns the Twilio message SID.
   * Blank or omitted targetPhone uses DEFAULT_RECIPIENT_PHONE; configuration and
   * delivery errors propagate.
   */
  async sendWhatsAppSecurityAlert(
    payload: SecurityAlertPayload,
    targetPhone?: string,
  ): Promise<string> {
    const message = [
      `🚨 *TRANSCEND KERNEL INTERVENTION*`,
      `*Action:* ${payload.actionTaken}`,
      `*PID:* \`${payload.pid}\``,
      `*Command:* \`${payload.command}\``,
      `*Timestamp:* ${payload.timestamp}`,
      `\n*Violations:*`,
      ...payload.violations.map((v) => `• ${v}`),
    ].join('\n');

    return this.sendWhatsApp(message, targetPhone);
  }

  /* ==========================================================================
     EMAIL DISPATCHERS (RESEND)
     ========================================================================== */

  /**
   * Dispatch full dark-mode HTML email report and return the Resend email ID.
   * Blank or omitted targetEmail uses DEFAULT_RECIPIENT_EMAIL. Missing settings, invalid
   * log URLs, provider failures, and responses without an email ID reject.
   */
  async sendPipelineEmailReport(
    payload: PipelineReportPayload,
    targetEmail?: string,
  ): Promise<string> {
    const resend = new Resend(this.requiredEnv('RESEND_API_KEY'));
    const from = this.requiredEnv('DISPATCH_FROM_EMAIL');
    const to =
      targetEmail?.trim() || this.requiredEnv('DEFAULT_RECIPIENT_EMAIL');
    const html = this.renderEmailTemplate(payload);

    const response = await resend.emails.send({
      from,
      to,
      subject: `[RyanAI] Pipeline ${payload.status}: ${payload.projectName} (${payload.branch})`,
      html,
    });

    if (response.error) {
      throw new Error(`Resend Email Error: ${response.error.message}`);
    }

    if (!response.data?.id) throw new Error('Resend returned no email ID');
    return response.data.id;
  }

  /**
   * Render an HTML report with escaped text and executionTimeMs displayed in seconds.
   * Throws if logUrl is not an absolute HTTP or HTTPS URL.
   */
  private renderEmailTemplate(payload: PipelineReportPayload): string {
    const escapeHtml = (value: string): string =>
      value.replace(
        /[&<>"']/g,
        (char) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[char]!,
      );
    const logUrl = new URL(payload.logUrl);
    if (logUrl.protocol !== 'https:' && logUrl.protocol !== 'http:') {
      throw new Error('Pipeline log URL must use HTTP or HTTPS');
    }
    const p = {
      ...payload,
      projectName: escapeHtml(payload.projectName),
      branch: escapeHtml(payload.branch),
      commitHash: escapeHtml(payload.commitHash.slice(0, 8)),
      author: escapeHtml(payload.author),
      status: escapeHtml(payload.status),
      logUrl: escapeHtml(logUrl.href),
      transcendStatus: {
        ...payload.transcendStatus,
        violations: payload.transcendStatus.violations.map(escapeHtml),
      },
    };
    const statusColor = p.status === 'SUCCESS' ? '#00ff9d' : '#ff0055';
    const statusBg = p.status === 'SUCCESS' ? '#002b1a' : '#330011';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { background-color: #050811; color: #a0aec0; font-family: 'Courier New', Courier, monospace; padding: 20px; margin: 0; }
    .container { max-width: 650px; margin: 0 auto; background-color: #0b1120; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; }
    .header { background-color: #020617; padding: 20px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
    .title { color: #38bdf8; font-size: 20px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 2px; }
    .status-badge { background-color: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusColor}; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; }
    .content { padding: 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .card { background-color: #020617; border: 1px solid #1e293b; padding: 12px; border-radius: 4px; }
    .card-label { color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
    .card-value { color: #f8fafc; font-size: 14px; font-weight: bold; }
    .violations-box { background-color: #1a050d; border: 1px solid #991b1b; padding: 16px; border-radius: 4px; margin-top: 16px; }
    .violations-title { color: #f87171; font-weight: bold; margin-bottom: 8px; }
    .violation-item { color: #fca5a5; font-size: 12px; margin-bottom: 4px; }
    .footer { background-color: #020617; padding: 16px; text-align: center; border-top: 1px solid #1e293b; font-size: 12px; color: #475569; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">RYAN_AI // TELEMETRY</div>
      <div class="status-badge">${p.status}</div>
    </div>
    <div class="content">
      <p style="color: #cbd5e1; margin-top: 0;">Automated pipeline execution finished for <strong>${p.projectName}</strong>.</p>

      <div class="grid">
        <div class="card">
          <div class="card-label">Target Branch</div>
          <div class="card-value">${p.branch}</div>
        </div>
        <div class="card">
          <div class="card-label">Commit Hash</div>
          <div class="card-value">${p.commitHash}</div>
        </div>
        <div class="card">
          <div class="card-label">Execution Duration</div>
          <div class="card-value">${(p.executionTimeMs / 1000).toFixed(2)}s</div>
        </div>
        <div class="card">
          <div class="card-label">Author</div>
          <div class="card-value">${p.author}</div>
        </div>
      </div>

      ${
        p.codeDiffSummary
          ? `
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-label">Code Diff Summary</div>
        <div class="card-value" style="color: #38bdf8;">
          ${p.codeDiffSummary.filesChanged} files changed |
          <span style="color: #4ade80;">+${p.codeDiffSummary.insertions}</span> |
          <span style="color: #f87171;">-${p.codeDiffSummary.deletions}</span>
        </div>
      </div>
      `
          : ''
      }

      ${
        p.transcendStatus.violationsCount > 0
          ? `
      <div class="violations-box">
        <div class="violations-title">⚠️ TRANSCEND GOVERNANCE VIOLATIONS (${p.transcendStatus.violationsCount})</div>
        ${p.transcendStatus.violations
          .map((v) => `<div class="violation-item">• ${v}</div>`)
          .join('')}
      </div>
      `
          : `
      <div class="card" style="border-color: #059669; background-color: #022c22;">
        <div class="card-label" style="color: #34d399;">Transcend Guard</div>
        <div class="card-value" style="color: #6ee7b7;">${p.transcendStatus.evaluated ? '✓ Zero policy violations detected' : 'Not evaluated'}</div>
      </div>
      `
      }

      <div style="text-align: center;">
        <a href="${p.logUrl}" class="btn">VIEW FULL MATRIX TRACE GRAPH</a>
      </div>
    </div>
    <div class="footer">
      Generated by RyanAI Autonomous Dev Engine • Transcend Governance Active
    </div>
  </div>
</body>
</html>
    `;
  }
}
