import nodemailer from 'nodemailer';

interface ApprovalNotification {
  threadId: string;
  tool: string;
  args: Record<string, unknown>;
}

export async function notifyPendingApproval({ threadId, tool, args }: ApprovalNotification) {
  const dashboardUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin/approvals';

  // 1. Send Slack Incoming Webhook Notification with Interactive Buttons
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const payload = {
        text: `🚨 RyanAI Action Pending Approval: ${tool}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚨 *Approval Required for Pending Action*\n*Thread ID:* \`${threadId}\`\n*Tool Request:* \`${tool}\``,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Arguments:*\n\`\`\`${JSON.stringify(args, null, 2)}\`\`\``,
            },
          },
          {
            type: 'actions',
            block_id: 'approval_actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Approve & Execute' },
                style: 'primary',
                action_id: 'approve_action',
                value: JSON.stringify({ threadId, approved: true }),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '❌ Reject Action' },
                style: 'danger',
                action_id: 'reject_action',
                value: JSON.stringify({ threadId, approved: false }),
              },
            ],
          },
        ],
      };

      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Failed to send Slack approval alert:', err);
    }
  }

  // 2. Send Admin Email Notification
  if (process.env.SMTP_USER && process.env.ADMIN_EMAIL) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'ryanai@example.com',
        to: process.env.ADMIN_EMAIL,
        subject: `[Action Required] RyanAI Pending Approval: ${tool}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 8px;">
            <h2 style="color: #fbbf24;">🛡️ Action Approval Required</h2>
            <p><strong>Thread ID:</strong> <code>${threadId}</code></p>
            <p><strong>Target Tool:</strong> <code>${tool}</code></p>
            <pre style="background: #1e293b; padding: 12px; border-radius: 6px; color: #34d399;">${JSON.stringify(args, null, 2)}</pre>
            <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 18px; background-color: #059669; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 12px;">Go to Admin Dashboard</a>
          </div>
        `,
      });
    } catch (err) {
      console.error('Failed to send Email approval alert:', err);
    }
  }
}