import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { jarvisClient } from '../../integrations/jarvis/client.js';
import { buildRyanAIStackManifest, type StackEnvironment } from '../../integrations/jarvis/stackManifest.js';

function requireJarvisAdmin(config?: RunnableConfig): string {
  if (config?.configurable?.role !== 'admin') {
    throw new Error('Jarvis patch and stack tools are for administrators only.');
  }
  const userId = config.configurable?.userId;
  return typeof userId === 'string' ? userId : 'admin';
}

function summarizeReceipt(receipt: Awaited<ReturnType<typeof jarvisClient.submitPatch>>) {
  return {
    accepted: receipt.accepted,
    statusCode: receipt.statusCode,
    remoteId: receipt.remoteId,
    remoteStatus: receipt.remoteStatus,
    submittedAt: receipt.submittedAt,
  };
}

export const jarvisStatusTool = tool(
  async (_input, config) => {
    requireJarvisAdmin(config);
    return JSON.stringify(await jarvisClient.status());
  },
  {
    name: 'jarvis_status',
    description: 'Checks whether the configured Jarvis bridge is enabled and reachable. Does not change files or deploy a stack.',
    schema: z.object({}),
  },
);

export const jarvisSubmitPatchTool = tool(
  async ({ title, targetPath, patchContent, branch, baseBranch, pullRequestUrl }, config) => {
    const requestedBy = requireJarvisAdmin(config);
    const receipt = await jarvisClient.submitPatch({
      title,
      targetPath,
      patchContent,
      branch,
      baseBranch,
      ...(pullRequestUrl ? { pullRequestUrl } : {}),
      requestedBy,
    });
    return JSON.stringify(summarizeReceipt(receipt));
  },
  {
    name: 'jarvis_submit_patch',
    description: 'Submits a candidate code patch to Jarvis for review. It does not apply files locally, merge a PR, or deploy anything. Jarvis sync must be explicitly enabled.',
    schema: z.object({
      title: z.string().min(1).max(240),
      targetPath: z.string().min(1).max(300).describe('Safe relative path of the proposed file change.'),
      patchContent: z.string().min(1).max(200000).describe('Full proposed file content for Jarvis review.'),
      branch: z.string().min(1).max(200),
      baseBranch: z.string().min(1).max(200),
      pullRequestUrl: z.string().url().optional(),
    }),
  },
);

export const jarvisPublishStackTool = tool(
  async ({ environment, branch, commitSha }, config) => {
    requireJarvisAdmin(config);
    const manifest = buildRyanAIStackManifest(environment as StackEnvironment, {
      branch,
      commitSha,
    });
    const receipt = await jarvisClient.publishStack(manifest);
    return JSON.stringify(summarizeReceipt(receipt));
  },
  {
    name: 'jarvis_publish_stack',
    description: 'Publishes RyanAI stack metadata to Jarvis. This sends a manifest only; it does not deploy services. Production publishing requires JARVIS_ALLOW_PRODUCTION_SYNC=true.',
    schema: z.object({
      environment: z.enum(['development', 'staging', 'production']),
      branch: z.string().max(200).optional(),
      commitSha: z.string().regex(/^[a-f0-9]{7,64}$/i).optional(),
    }),
  },
);

export const jarvisTools = [
  jarvisStatusTool,
  jarvisSubmitPatchTool,
  jarvisPublishStackTool,
];