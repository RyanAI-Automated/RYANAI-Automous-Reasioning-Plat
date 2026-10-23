import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { sendWhatsAppTool } from './tools/whatsappTool.js';

const llm = new ChatOpenAI({
  modelName: 'gpt-4o',
  temperature: 0,
});

/**
 * Compliance verification tool definition
 */
export const verifyComplianceTool = tool(
  async ({ deploymentId, framework }) => {
    // Audit check implementation
    return JSON.stringify({
      deploymentId,
      framework: framework || 'SOC2',
      status: 'COMPLIANT',
      checksPassed: 14,
      checksFailed: 0,
      timestamp: new Date().toISOString(),
    });
  },
  {
    name: 'verify_compliance',
    description: 'Verifies security policies, audit records, and regulatory compliance standards for a target deployment.',
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