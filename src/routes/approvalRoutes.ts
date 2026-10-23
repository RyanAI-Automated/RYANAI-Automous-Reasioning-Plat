import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pendingApprovals } from '../middleware/ibacGuardrail';

interface ApprovalParams {
  approvalId: string;
}

export async function registerApprovalRoutes(fastify: FastifyInstance) {
  
  // Handle Approval Click
  fastify.post<{ Params: ApprovalParams }>('/api/v1/approvals/:approvalId/approve', async (request: FastifyRequest<{ Params: ApprovalParams }>, reply: FastifyReply) => {
    const { approvalId } = request.params;
    const record = pendingApprovals.get(approvalId);

    if (!record) {
      return reply.status(404).send({ error: 'Approval request not found or expired.' });
    }

    if (record.status !== 'PENDING') {
      return reply.status(400).send({ error: `Approval request is already ${record.status}` });
    }

    record.status = 'APPROVED';
    pendingApprovals.set(approvalId, record);

    fastify.log.info(`[IBAC Security] Approval ${approvalId} granted for agent ${record.requestPayload.agentId}`);

    // Return success message for the reviewer browser / Slack block UI
    return reply.type('text/html').send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: #f8fafc;">
          <h2 style="color: #22c55e;">✅ RyanAI Action Approved</h2>
          <p>The ephemeral credential for agent <code>${record.requestPayload.agentId}</code> has been successfully generated.</p>
        </body>
      </html>
    `);
  });

  // Handle Denial Click
  fastify.post<{ Params: ApprovalParams }>('/api/v1/approvals/:approvalId/deny', async (request: FastifyRequest<{ Params: ApprovalParams }>, reply: FastifyReply) => {
    const { approvalId } = request.params;
    const record = pendingApprovals.get(approvalId);

    if (!record) {
      return reply.status(404).send({ error: 'Approval request not found or expired.' });
    }

    record.status = 'DENIED';
    pendingApprovals.set(approvalId, record);

    fastify.log.warn(`[IBAC Security] Approval ${approvalId} denied for agent ${record.requestPayload.agentId}`);

    return reply.type('text/html').send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: #f8fafc;">
          <h2 style="color: #ef4444;">❌ RyanAI Action Denied</h2>
          <p>The request from agent <code>${record.requestPayload.agentId}</code> was halted and recorded.</p>
        </body>
      </html>
    `);
  });
}
