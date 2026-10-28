import { dispatchAction } from '../approvals/dispatch.js';
import { escapeXml, parseActionArgs } from '../approvals/rules.js';

export interface Channels {
  slackWebhookUrl?: string;
  email?: string;
  whatsappTo?: string;
}

export interface NotifyDeps {
  fetcher?: typeof fetch;
  dispatch?: typeof dispatchAction;
}

export interface ChannelOutcome {
  channel: 'slack' | 'email' | 'whatsapp';
  ok: boolean;
  error?: string;
}

const WHATSAPP_MAX_CHARS = 1500;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Send an alert to every channel that has a destination, at the same time.
 * The owner set these destinations in the environment, so the alert goes out
 * without approval. A channel that fails does not stop the others.
 */
export async function notifyOwner(
  message: string,
  channels: Channels,
  { fetcher = fetch, dispatch = dispatchAction }: NotifyDeps = {},
): Promise<ChannelOutcome[]> {
  const headline = message.split('\n')[0].slice(0, 150);
  const jobs: { channel: ChannelOutcome['channel']; run: () => Promise<unknown> }[] = [];

  if (channels.slackWebhookUrl) {
    const url = channels.slackWebhookUrl;
    jobs.push({
      channel: 'slack',
      run: async () => {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Slack answered HTTP ${response.status}.`);
      },
    });
  }
  if (channels.email) {
    const to = channels.email;
    jobs.push({
      channel: 'email',
      run: () =>
        dispatch(
          'send_email',
          parseActionArgs('send_email', {
            to,
            subject: `[RyanAI alert] ${headline}`.replace(/[\r\n]+/g, ' '),
            html: `<pre style="font-family: monospace">${escapeXml(message)}</pre>`,
          }),
        ),
    });
  }
  if (channels.whatsappTo) {
    const to = channels.whatsappTo;
    jobs.push({
      channel: 'whatsapp',
      run: () =>
        dispatch(
          'send_whatsapp_message',
          parseActionArgs('send_whatsapp_message', { to, message: message.slice(0, WHATSAPP_MAX_CHARS) }),
        ),
    });
  }

  // An async wrapper turns an error that a job throws at once, such as a bad
  // recipient, into a rejected promise, so it stays the outcome of that channel.
  const settled = await Promise.allSettled(jobs.map(async (job) => job.run()));
  return settled.map((result, index) => ({
    channel: jobs[index].channel,
    ok: result.status === 'fulfilled',
    ...(result.status === 'rejected' ? { error: errorText(result.reason) } : {}),
  }));
}
