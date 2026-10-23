/**
 * RyanAI Communications Plugin
 * Handles outbound messaging channels (WhatsApp, Slack, Email)
 */

export async function commsPlugin(fastify, options) {
  // Send a communication message
  fastify.post('/api/comms/send', async (request, reply) => {
    const { channel, recipient, message } = request.body || {};

    if (!channel || !recipient || !message) {
      return reply.code(400).send({
        success: false,
        error: 'Missing required fields: channel, recipient, and message are required.',
      });
    }

    fastify.log.info(`[Comms] Dispatching message via ${channel} to ${recipient}`);

    // Simulate successful message dispatch
    return {
      success: true,
      channel,
      recipient,
      messageId: `msg_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };
  });

  // Get communication status/history health check
  fastify.get('/api/comms/status', async () => {
    return {
      status: 'online',
      supportedChannels: ['whatsapp', 'slack', 'email'],
      timestamp: new Date().toISOString(),
    };
  });
}