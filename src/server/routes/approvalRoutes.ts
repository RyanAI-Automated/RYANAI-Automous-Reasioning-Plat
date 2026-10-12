import { requireAdmin } from './auth.js';
import { FastifyPluginAsync } from 'fastify';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { enterpriseMultiAgent } from '../../agent/supervisorGraph.js';
import { notifyPendingApproval } from '../../utils/notifications.js';

interface WithApprovalBody {
  prompt: string;
  threadId: string;
}

interface ApproveBody {
  threadId: string;
  approved: boolean;
}

interface AdminResolveBody {
  approved: boolean;
}

/**
 * Register admin-only endpoints to start, inspect, resume, or reject agent threads.
 * Pending single-agent tool calls trigger approval notifications. Multi-agent resolve
 * failures return 500; uncaught agent errors in other handlers reach Fastify.
 */
export const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  // 1. Initial Prompt Handler for Single Agent: Halts when a tool is called & triggers notification
  fastify.post<{ Body: WithApprovalBody }>(
    '/api/reason/with-approval',
    async (request, reply) => {
      const { prompt, threadId } = request.body || {};
      if (!threadId || !prompt) {
        reply.status(400);
        return { error: 'Both prompt and threadId are required.' };
      }

      const config = { configurable: { thread_id: threadId } };

      // Run agent up to the interrupt point
      await humanInTheLoopAgent.invoke(
        { messages: [{ role: 'user', content: prompt }] },
        config,
      );

      // Inspect graph state to verify pending tool call
      const currentState = await humanInTheLoopAgent.getState(config);

      if (currentState.next && currentState.next.includes('tools')) {
        const lastMessage = currentState.values?.messages?.at(-1);
        const pendingTool = lastMessage?.tool_calls?.[0];

        // Dispatch notification asynchronously
        try {
          notifyPendingApproval({
            threadId,
            tool: pendingTool?.name || 'unknown_tool',
            args: pendingTool?.args || {},
          });
        } catch (err) {
          fastify.log.warn(
            `Failed to dispatch notification: ${(err as Error).message}`,
          );
        }

        return {
          status: 'PENDING_APPROVAL',
          threadId,
          pendingAction: {
            tool: pendingTool?.name,
            arguments: pendingTool?.args,
          },
          message: 'Tool execution paused. Notification sent to admin.',
        };
      }

      return {
        status: 'COMPLETED',
        response: currentState.values?.messages?.at(-1)?.content,
      };
    },
  );

  // 2. Resume Endpoint for Single Agent: Resumes or cancels tool execution based on user response
  fastify.post<{ Body: ApproveBody }>(
    '/api/reason/approve',
    async (request, reply) => {
      const { threadId, approved } = request.body || {};
      if (!threadId) {
        reply.status(400);
        return { error: 'threadId is required.' };
      }

      const config = { configurable: { thread_id: threadId } };

      if (!approved) {
        // User rejected action: Feed rejection back into conversation without running tool
        const rejectedResult = await humanInTheLoopAgent.invoke(
          {
            messages: [
              {
                role: 'user',
                content: 'Action rejected by admin. Do not execute the tool.',
              },
            ],
          },
          config,
        );

        return {
          status: 'REJECTED',
          response: rejectedResult?.messages?.at(-1)?.content,
        };
      }

      // User approved: Passing `null` resumes execution from the saved checkpoint
      const approvedResult = await humanInTheLoopAgent.invoke(null, config);

      return {
        status: 'EXECUTED',
        response: approvedResult?.messages?.at(-1)?.content,
      };
    },
  );

  // 3. Multi-Agent Supergraph: Check current thread state for pending worker interrupts
  fastify.get<{ Params: { threadId: string } }>(
    '/api/admin/threads/:threadId/pending',
    async (request) => {
      const { threadId } = request.params;
      const config = { configurable: { thread_id: threadId } };

      const state = await enterpriseMultiAgent.getState(config);

      if (!state.next || state.next.length === 0) {
        return {
          paused: false,
          message: 'No active interruptions on this thread.',
        };
      }

      return {
        paused: true,
        nextNodes: state.next, // e.g., ['commsWorker']
        pendingMessage: state.values?.messages?.at(-1),
      };
    },
  );

  // 4. Multi-Agent Supergraph: Resume graph execution upon admin approval or rejection
  fastify.post<{ Params: { threadId: string }; Body: AdminResolveBody }>(
    '/api/admin/threads/:threadId/resolve',
    async (request, reply) => {
      const { threadId } = request.params;
      const { approved } = request.body || {};
      const config = { configurable: { thread_id: threadId } };

      try {
        let result;

        if (approved) {
          // Resume graph execution by passing null to continue past the interrupt breakpoint
          result = await enterpriseMultiAgent.invoke(null, config);
        } else {
          // If rejected, inject rejection feedback into conversation state
          result = await enterpriseMultiAgent.invoke(
            {
              messages: [
                {
                  role: 'user',
                  content:
                    'Execution rejected by administrator. Halt task processing.',
                },
              ],
            },
            config,
          );
        }

        return { success: true, result };
      } catch (err: unknown) {
        reply.status(500);
        return { success: false, error: (err as Error).message };
      }
    },
  );
};
