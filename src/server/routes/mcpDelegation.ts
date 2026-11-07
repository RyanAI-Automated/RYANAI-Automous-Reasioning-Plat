import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { requireUser } from './auth.js';
import { hasValidMcpServiceToken, issueMcpDelegationToken, MCP_READ_ONLY_SCOPES } from '../security/mcpDelegation.js';

interface DelegationBody { scopes: string[]; }

const scopeToolNames: Record<string, string> = {
  tool_registry: 'mcp_tool_registry',
  repository_status: 'mcp_repository_status',
  platform_health: 'mcp_platform_health',
  ryanai_stack_manifest: 'mcp_stack_manifest',
};

function requireMcpService(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.RYANAI_MCP_SERVICE_TOKEN?.trim() ?? '';
  if (expected.length < 32) {
    return reply.code(503).send({ error: 'MCP service authentication is not configured.' });
  }
  if (!hasValidMcpServiceToken(request.headers['x-ryanai-service-token'], expected)) {
    return reply.code(401).send({ error: 'Unauthorized MCP service.' });
  }
}

export const mcpDelegationRoutes: FastifyPluginAsync = async (fastify) => {
  if (!fastify.hasRequestDecorator('authUser')) fastify.decorateRequest('authUser', null);
  fastify.post<{ Body: DelegationBody }>('/api/internal/mcp/delegation', {
    preHandler: [requireMcpService, requireUser],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['scopes'],
        additionalProperties: false,
        properties: {
          scopes: {
            type: 'array',
            minItems: 1,
            maxItems: MCP_READ_ONLY_SCOPES.length,
            uniqueItems: true,
            items: { type: 'string', enum: [...MCP_READ_ONLY_SCOPES] },
          },
        },
      },
    },
  }, async (request, reply) => {
    const principal = request.authUser;
    if (!principal?.id) return reply.code(401).send({ error: 'Verified user identity is required.' });

    const environment = process.env.NODE_ENV === 'production' ? 'production'
      : process.env.NODE_ENV === 'staging' ? 'staging' : 'development';
    for (const scope of request.body.scopes) {
      const policy = evaluateGenXSecurityEvent({
        agentId: 'mcp-gateway',
        principal: principal.id,
        toolName: scopeToolNames[scope],
        action: 'READ',
        target: 'mcp:' + scope,
        environment,
      });
      if (policy.decision !== 'ALLOW') {
        fastify.log.warn({ ruleId: policy.ruleId, principal: principal.id, scope }, 'Gen-X denied MCP delegation scope');
        return reply.code(403).send({ error: 'Gen-X denied the requested MCP capability.', ruleId: policy.ruleId });
      }
    }

    const secret = process.env.RYANAI_MCP_DELEGATION_SECRET?.trim() ?? '';
    if (secret.length < 32) {
      return reply.code(503).send({ error: 'MCP delegation signing is not configured.' });
    }
    try {
      const issued = issueMcpDelegationToken({
        subject: principal.id,
        role: principal.role,
        scopes: request.body.scopes,
        secret,
      });
      return {
        token: issued.token,
        tokenType: 'Bearer',
        audience: 'ryanai-mcp',
        expiresAt: new Date(issued.expiresAt * 1000).toISOString(),
        scopes: issued.claims.scope,
      };
    } catch {
      return reply.code(400).send({ error: 'Unable to issue delegated MCP identity.' });
    }
  });
};
