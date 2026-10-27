import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { sendWhatsAppTool } from './tools/whatsappTool.js';
import { createChatModel } from '../config/llm.js';

const llm = createChatModel();

/**
 * Compliance verification tool definition
 */
export const verifyComplianceTool = tool(
  async ({ deploymentId, framework }) => {
    // No automated compliance checks are connected yet. Never report a pass.
    return JSON.stringify({
      deploymentId,
      framework: framework || 'SOC2',
      status: 'NOT_VERIFIED',
      note: 'No automated compliance checks are connected. Do not tell the user that this deployment is compliant.',
      timestamp: new Date().toISOString(),
    });
  },
  {
    name: 'verify_compliance',
    description: 'Requests a compliance check for a target deployment. No automated checks are connected yet, so the result is always NOT_VERIFIED.',
    schema: z.object({
      deploymentId: z.string().describe('The deployment reference ID (e.g. #402).'),
      framework: z.string().optional().describe('Target compliance framework (e.g., SOC2, ISO27001, HIPAA).'),
    }),
  }
);

// 1. Communications Sub-Agent (Handles messaging, alerts, notifications)
export const commsSubAgent = createReactAgent({
  llm,
  tools: [sendWhatsAppTool],
  stateModifier: new SystemMessage(
    'You are a specialized communications agent. Dispatch outbound notifications cleanly and accurately using available tools.'
  ),
});

// 2. Compliance Sub-Agent (Handles security checks, policy validations)
export const complianceSubAgent = createReactAgent({
  llm,
  tools: [verifyComplianceTool],
  stateModifier: new SystemMessage(
    'You are a strict compliance officer agent. Verify parameters against enterprise security and regulatory standards.'
  ),
});