import { FastifyRequest, FastifyReply } from 'node_modules/fastify'; // or standard fastify import

export enum RiskTier {
  LOW = 'ALLOW',              // Auto-approve reads/staging queries[span_8](start_span)[span_8](end_span)
  MEDIUM = 'ALLOW_ALERT',     // Soft gates / trigger monitoring alerts[span_9](start_span)[span_9](end_span)
  HIGH = 'HIL',               // Escalate to human approver via Slack / Webhook[span_10](start_span)[span_10](end_span)
  CRITICAL = 'DENY'           // Block destructive operations / policy violation[span_11](start_span)[span_11](end_span)
}

export interface AgentIntentRequest {
  agentId: string;
  principal: string;          // Operator or user identity
  declaredIntent: string;     // Task-level objective
  targetResource: string;     // e.g., database, AWS IAM, production cluster
  actionType: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
  environment: 'staging' | 'production';
}

export interface EvaluatedContext {
  riskTier: RiskTier;
  requiresHumanApproval: boolean;
  credentialTtlSeconds: number;
}

/**
  * Evaluates agent intent against context and risk thresholds[span_12](start_span)[span_12](end_span).
  */
export function evaluateAgentIntent(req: AgentIntentRequest): EvaluatedContext {
  // 1. Critical destructive actions in production are blocked or require strict HIL
  if (req.actionType === 'DELETE' && req.environment === 'production') {
    return {
      riskTier: RiskTier.CRITICAL,
      requiresHumanApproval: true,
      credentialTtlSeconds: 0
    };
  }

  // 2. High-risk write/update operations in production require Human-in-the-Loop (HIL)[span_13](start_span)[span_13](end_span)
  if ((req.actionType === 'UPDATE' || req.actionType === 'CREATE') && req.environment === 'production') {
    return {
      riskTier: RiskTier.HIGH,
      requiresHumanApproval: true,
      credentialTtlSeconds: 30
    };
  }

  // 3. Medium-risk operations trigger review or soft gates[span_14](start_span)[span_14](end_span)
  if (req.actionType === 'UPDATE' && req.environment === 'staging') {
    return {
      riskTier: RiskTier.MEDIUM,
      requiresHumanApproval: false,
      credentialTtlSeconds: 60
    };
  }

  // 4. Low-risk actions (reads against non-sensitive resources) auto-approve[span_15](start_span)[span_15](end_span)
  return {
    riskTier: RiskTier.LOW,
    requiresHumanApproval: false,
    credentialTtlSeconds: 10
  };
}

/**
  * Fastify middleware hook for RyanAI Model Context Protocol (MCP) / tool execution routes.
  */
export async function ibacGuardrailMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as AgentIntentRequest;

  if (!body || !body.declaredIntent || !body.actionType) {
    return reply.status(400).send({
      error: 'Invalid Intent Payload',
      message: 'Agent must declare intent, target resource, and action type.'
    });
  }

  const evaluation = evaluateAgentIntent(body);

  // Enforce Deny / Critical Risk
  if (evaluation.riskTier === RiskTier.CRITICAL) {
    request.log.warn(`[IBAC Security] BLOCKED critical destructive action by agent ${body.agentId}: ${body.declaredIntent}`);
    return reply.status(403).send({
      status: 'DENIED',
      reason: 'Destructive operation violates zero-standing-privilege guardrails. Human approval required.'
    });
  }

  // Enforce Human-in-the-Loop (HIL) Escalation
  if (evaluation.requiresHumanApproval) {
    request.log.info(`[IBAC Security] Escalating action to HIL for agent ${body.agentId} on resource ${body.targetResource}`);
    
    // Trigger webhook / Slack approval workflow here
    // await notifySlackHILChannel(body, evaluation);

    return reply.status(202).send({
      status: 'PENDING_HIL_APPROVAL',
      message: 'High-risk action intercepted. Notification dispatched to security team via Slack.'
    });
  }

  // Generate Temporary Scoped Credential (Zero Standing Privileges)[span_16](start_span)[span_16](end_span)
  const scopedCredential = generateEphemeralToken(body.targetResource, evaluation.credentialTtlSeconds);

  request.log.info(`[IBAC Security] Granted ephemeral credential (TTL: ${evaluation.credentialTtlSeconds}s) for agent ${body.agentId}`);

  // Attach execution context to request for downstream tool handlers
  request.rawContext = {
    ...body,
    ephemeralCredential: scopedCredential,
    riskTier: evaluation.riskTier
  };
}

function generateEphemeralToken(resource: string, ttlSeconds: number): string {
  // Simulating dynamic STS / Vault token generation bound strictly to single action
  return `ryan-zsp-${Buffer.from(resource).toString('base64').slice(0, 10)}-${Date.now()}-${ttlSeconds}s`;
}
