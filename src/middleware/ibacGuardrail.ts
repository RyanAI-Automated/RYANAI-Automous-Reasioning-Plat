import { FastifyRequest, FastifyReply } from 'fastify';

export enum RiskTier {
  LOW = 'ALLOW',              // Auto-approve reads/staging queries[span_1](start_span)[span_1](end_span)
  MEDIUM = 'ALLOW_ALERT',     // Soft gates / trigger monitoring alerts[span_2](start_span)[span_2](end_span)
  HIGH = 'HIL',               // Escalate to human approver via Slack / Webhook[span_3](start_span)[span_3](end_span)
  CRITICAL = 'DENY'           // Block destructive operations / policy violation[span_4](start_span)[span_4](end_span)
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

// In-memory store for tracking pending HIL approvals (in production, use Redis)
export const pendingApprovals = new Map<string, {
  requestPayload: AgentIntentRequest;
  createdAt: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
}>();

/**
 * Evaluates agent intent against context and risk thresholds[span_5](start_span)[span_5](end_span).
 */
export function evaluateAgentIntent(req: AgentIntentRequest): EvaluatedContext {
  if (req.actionType === 'DELETE' && req.environment === 'production') {
    return {
      riskTier: RiskTier.CRITICAL,
      requiresHumanApproval: true,
      credentialTtlSeconds: 0
    };
  }

  if ((req.actionType === 'UPDATE' || req.actionType === 'CREATE') && req.environment === 'production') {
    return {
      riskTier: RiskTier.HIGH,
      requiresHumanApproval: true,
      credentialTtlSeconds: 30
    };
  }

  if (req.actionType === 'UPDATE' && req.environment === 'staging') {
    return {
      riskTier: RiskTier.MEDIUM,
      requiresHumanApproval: false,
      credentialTtlSeconds: 60
    };
  }

  return {
    riskTier: RiskTier.LOW,
    requiresHumanApproval: false,
    credentialTtlSeconds: 10
  };
}

/**
 * Dispatches a rich context notification to Slack for Human-in-the-Loop (HIL) approval[span_6](start_span)[span_6](end_span).
 */
async function notifySlackHILChannel(req: AgentIntentRequest, approvalId: string): Promise<void> {
  const webhookUrl = process.env.SLACK_HIL_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('[IBAC Security] SLACK_HIL_WEBHOOK_URL is not defined. Skipping webhook dispatch.');
    return;
  }

  const slackPayload = {
    text: `🚨 *RyanAI Agent Privilege Escalation [HIL Required]*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*High-Risk Action Intercepted*\nA RyanAI autonomous agent has requested a privileged operation requiring human review[span_7](start_span)[span_7](end_span).`
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Agent ID:*\n\`${req.agentId}\`` },
          { type: 'mrkdwn', text: `*Operator:* \`${req.principal}\`` },
          { type: 'mrkdwn', text: `*Environment:* \`${req.environment}\`` },
          { type: 'mrkdwn', text: `*Action / Target:* \`${req.actionType} -> ${req.targetResource}\`` }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Declared Intent:*\n> "${req.declaredIntent}"`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve Action' },
            style: 'primary',
            value: approvalId,
            url: `https://ryanai.gateway/api/v1/approvals/${approvalId}/approve`
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Deny & Halt' },
            style: 'danger',
            value: approvalId,
            url: `https://ryanai.gateway/api/v1/approvals/${approvalId}/deny`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload)
    });

    if (!response.ok) {
      throw new Error(`Slack API responded with status ${response.status}`);
    }
  } catch (error) {
    console.error('[IBAC Security] Failed to dispatch Slack HIL notification:', error);
  }
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

  if (evaluation.riskTier === RiskTier.CRITICAL) {
    request.log.warn(`[IBAC Security] BLOCKED critical destructive action by agent ${body.agentId}: ${body.declaredIntent}`);
    return reply.status(403).send({
      status: 'DENIED',
      reason: 'Destructive operation violates zero-standing-privilege guardrails. Human approval required.'
    });
  }

  if (evaluation.requiresHumanApproval) {
    const approvalId = `hil-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Store pending approval state
    pendingApprovals.set(approvalId, {
      requestPayload: body,
      createdAt: Date.now(),
      status: 'PENDING'
    });

    request.log.info(`[IBAC Security] Escalating action to HIL [ID: ${approvalId}] for agent ${body.agentId} on resource ${body.targetResource}`);
    
    // Dispatch full context to Slack asynchronously
    await notifySlackHILChannel(body, approvalId);

    return reply.status(202).send({
      status: 'PENDING_HIL_APPROVAL',
      approvalId,
      message: 'High-risk action intercepted. Full context and interactive approval blocks dispatched to security team via Slack[span_8](start_span)[span_8](end_span).'
    });
  }

  const scopedCredential = generateEphemeralToken(body.targetResource, evaluation.credentialTtlSeconds);

  request.log.info(`[IBAC Security] Granted ephemeral credential (TTL: ${evaluation.credentialTtlSeconds}s) for agent ${body.agentId}`);

  // Attach execution context to request for downstream tool handlers
  Object.assign(request, {
    rawContext: {
      ...body,
      ephemeralCredential: scopedCredential,
      riskTier: evaluation.riskTier,
    },
  });
}

function generateEphemeralToken(resource: string, ttlSeconds: number): string {
  return `ryan-zsp-${Buffer.from(resource).toString('base64').slice(0, 10)}-${Date.now()}-${ttlSeconds}s`;
}
