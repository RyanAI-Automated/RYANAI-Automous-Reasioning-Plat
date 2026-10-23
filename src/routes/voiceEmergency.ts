import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';

interface EmergencyTwimlQuery {
  pid?: string;
  reason?: string;
  message?: string;
}

/**
 * Register emergency TwiML with a six-second DTMF/speech prompt and hangup fallback.
 * The route generates call instructions; it does not change kernel blocks.
 */
export async function voiceEmergencyRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/voice/emergency-twiml', async (req: FastifyRequest<{ Querystring: EmergencyTwimlQuery }>, reply: FastifyReply) => {
    const { pid = '0', message } = req.query;

    const response = new twilio.twiml.VoiceResponse();

    // Initial alert pause
    response.pause({ length: 1 });

    const gather = response.gather({
      input: ['dtmf', 'speech'],
      timeout: 6,
      numDigits: 1,
      action: `${process.env.BASE_URL}/api/v1/voice/interactive`,
      method: 'POST',
    });

    // Neural voice prompt assigned to Ryan
    gather.say(
      {
        voice: 'Polly.Matthew',
        language: 'en-US',
      },
      `Emergency Alert. ${message} Press 1 to confirm system lock. Press 2 to clear kernel block.`
    );

    // Fallback if user doesn't respond
    response.say(
      { voice: 'Polly.Matthew' },
      `No input received. Transcend kernel block remains active on PID ${pid}. Signing off.`
    );
    response.hangup();

    reply.header('Content-Type', 'text/xml');
    return reply.send(response.toString());
  });
}