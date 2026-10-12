import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EbpfSentinelService } from '../services/ebpfSentinel';
import { EmergencyVoiceAlertService } from '../services/emergencyVoiceAlert';

const ebpfSentinel = new EbpfSentinelService();
const emergencyVoiceAlert = new EmergencyVoiceAlertService();

/**
 * Register policy evaluation for agent execution requests.
 * A denial attempts process termination and a background voice alert before HTTP 403;
 * an allowed request is acknowledged without executing its command.
 */
export async function agentExecuteRoutes(fastify: FastifyInstance) {
  fastify.post('/api/v1/agent/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const inputPayload = request.body as { pid?: number; command?: string };
    const targetPid = inputPayload.pid || request.raw.socket.remotePort || Math.floor(Math.random() * 8000 + 1000);
    const attemptedCommand = inputPayload.command || 'unknown_execution';

    // 1. Evaluate payload against Transcend WASM Policy Engine
    const evaluation = fastify.transcend.evaluate(inputPayload);

    // 2. Policy Violation Intercept
    if (!evaluation.allow) {
      const timestamp = new Date().toISOString();

      // Step A: Immediate Kernel SIGKILL via eBPF Map Update
      await ebpfSentinel.terminatePidInKernel(targetPid);

      // Step B: Trigger Immediate Outbound Phone Call from Ryan (Non-blocking)
      emergencyVoiceAlert
        .dispatchKernelKillCall({
          pid: targetPid,
          command: attemptedCommand,
          violations: evaluation.violations,
          timestamp,
        })
        .catch((err) =>
          fastify.log.error(err, 'Failed background emergency voice dispatch')
        );

      // Return instant security block response to HTTP client
      return reply.status(403).send({
        status: 'TRANSCEND_KERNEL_KILL_ENGAGED',
        action: 'SIGKILL',
        pid: targetPid,
        telephony: 'OUTBOUND_VOICE_CALL_DISPATCHED',
        violations: evaluation.violations,
        timestamp,
      });
    }

    // Safe execution path
    return reply.send({ status: 'ALLOWED', payload: inputPayload });
  });
}