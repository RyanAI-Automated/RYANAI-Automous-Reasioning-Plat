import type { RunnableConfig } from '@langchain/core/runnables';

/**
 * Read the signed-in user's id from the run config (configurable.userId).
 * The routes set it from the verified session. Without it, the tools fail,
 * so one user can never read or change the data of another user.
 */
export function requireUserId(config?: RunnableConfig): string {
  const userId = config?.configurable?.userId;
  if (typeof userId !== 'string' || !userId) {
    throw new Error('This tool needs an authenticated user.');
  }
  return userId;
}
