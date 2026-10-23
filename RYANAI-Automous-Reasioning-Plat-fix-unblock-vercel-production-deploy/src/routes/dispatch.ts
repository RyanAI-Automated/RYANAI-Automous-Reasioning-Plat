import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DispatchService, PipelineReportPayload, SecurityAlertPayload } from '../services/dispatchService';

const dispatch = new DispatchService();

/**
 * Register pipeline-report and security-alert dispatch endpoints.
 * Pipeline reports send WhatsApp and email concurrently; a failure returns HTTP 500
 * even if the other delivery succeeds.
 */
export async function dispatchRoutes(fastify: FastifyInstance) {
  // Trigger WhatsApp + Email dual dispatch
  fastify.post('/api/v1/dispatch/pipeline-report', async (req: FastifyRequest<{ Body: PipelineReportPayload }>, reply: FastifyReply) => {
    try {
      const payload = req.body;

      const [whatsappSid, emailId] = await Promise.all([
        dispatch.sendWhatsAppPipelineUpdate(payload),
        dispatch.sendPipelineEmailReport(payload),
      ]);

      return reply.send({
        success: true,
        dispatches: {
          whatsapp: { sid: whatsappSid, status: 'DELIVERED' },
          email: { id: emailId, status: 'DELIVERED' },
        },
      });
    } catch (error: unknown) {
      fastify.log.error(error, 'Multi-channel dispatch failed');
      return reply.status(500).send({
        error: 'DISPATCH_FAILURE',
        details: (error instanceof Error ? error.message : String(error)),
      });
    }
  });

  // Emergency WhatsApp security dispatch
  fastify.post('/api/v1/dispatch/security-alert', async (req: FastifyRequest<{ Body: SecurityAlertPayload }>, reply: FastifyReply) => {
    try {
      const whatsappSid = await dispatch.sendWhatsAppSecurityAlert(req.body);
      return reply.send({ success: true, whatsappSid });
    } catch (error: unknown) {
      return reply.status(500).send({ error: (error instanceof Error ? error.message : String(error)) });
    }
  });
}