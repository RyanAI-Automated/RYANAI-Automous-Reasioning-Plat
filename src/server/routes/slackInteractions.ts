import { FastifyPluginAsync } from 'fastify';
import formbody from '@fastify/formbody';
import fastifyRawBody from 'fastify-raw-body';
import querystring from 'querystring';
import { verifySlackSignature } from '../../utils/slackVerification.js';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';

/** Normalizes an agent message's content into a plain string, serializing non-string values. */
const extractContent = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content) ?? '';

/** Registers the Slack interactions webhook, verifying the request signature before resuming the approval flow. */
export const slackInteractionsPlugin: FastifyPluginAsync = async (fastify) => {
  // 1. Register raw-body plugin to preserve original request string
  await fastify.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  await fastify.register(formbody);

  fastify.post(
    '/api/slack/interactions',
    {
      config: { rawBody: true },
      preHandler: async (request, reply) => {
        const signingSecret = process.env.SLACK_SIGNING_SECRET;

        if (!signingSecret) {
          fastify.log.error('SLACK_SIGNING_SECRET is not configured');
          reply.status(500);
          return reply.send({ error: 'Server security configuration error' });
        }

        const signature = request.headers['x-slack-signature'] as string;
        const timestamp = request.headers['x-slack-request-timestamp'] as string;
        const rawBody = request.rawBody?.toString() || '';

        const isValid = verifySlackSignature({
          signingSecret,
          requestSignature: signature,
          timestamp,
          rawBody,
        });

        if (!isValid) {
          fastify.log.warn('Unauthorized Slack interaction request failed HMAC verification');
          reply.status(401);
          return reply.send({ error: 'Invalid Slack request signature' });
        }
        return;
      },
    },
    async (request, reply) => {
      // Parse form payload from verified raw body
      const rawBody = request.rawBody?.toString() || '';
      const parsedBody = querystring.parse(rawBody);

      if (!parsedBody.payload) {
        reply.status(400);
        return { error: 'Missing payload' };
      }

      const payload = JSON.parse(parsedBody.payload as string);
      const action = payload.actions?.[0];
      const user = payload.user?.username || payload.user?.name || 'Admin';

      if (!action || !action.value) {
        return reply.status(200).send();
      }

      const { threadId, approved } = JSON.parse(action.value);
      const config = { configurable: { thread_id: threadId } };

      let resultMessage = '';

      if (approved) {
        const approvedResult = await humanInTheLoopAgent.invoke(null, config);
        resultMessage = extractContent(approvedResult.messages.at(-1)?.content) || 'Executed successfully.';
      } else {
        const rejectedResult = await humanInTheLoopAgent.invoke(
          {
            messages: [
              { role: 'user', content: 'Action rejected by admin in Slack. Cancel execution.' },
            ],
          },
          config
        );
        resultMessage = extractContent(rejectedResult.messages.at(-1)?.content) || 'Action canceled.';
      }

      return {
        replace_original: true,
        text: `${approved ? '✅ *Approved*' : '❌ *Rejected*'} by @${user}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${approved ? '✅ *Action Approved & Executed*' : '❌ *Action Rejected*'} by *@${user}*\n*Thread ID:* \`${threadId}\`\n\n*Result:* ${resultMessage}`,
            },
          },
        ],
      };
    }
  );
};