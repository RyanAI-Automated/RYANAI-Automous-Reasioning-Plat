import { dispatchAction } from './dispatch.js';
import { claimAction, finishAction } from './pendingStore.js';
import { isActionTool, parseActionArgs } from './rules.js';

export type DecisionResult =
  | { outcome: 'not_found' }
  | { outcome: 'rejected' }
  | { outcome: 'executed'; result: string }
  | { outcome: 'failed'; error: string };

export interface DecisionDeps {
  claim: typeof claimAction;
  finish: typeof finishAction;
  dispatch: typeof dispatchAction;
}

const defaultDeps: DecisionDeps = {
  claim: claimAction,
  finish: finishAction,
  dispatch: dispatchAction,
};

/**
 * Approve or reject one pending action.
 * The claim is one conditional update, so an action is decided once. A second
 * click, or a second server, gets "not_found". An approved action is sent at most
 * once. If the server stops between the claim and the end of the send, the row
 * stays "approved" and nothing sends it again. The approver can check the table.
 */
export async function decideAction(
  id: string,
  adminId: string,
  approve: boolean,
  deps: DecisionDeps = defaultDeps,
): Promise<DecisionResult> {
  const action = await deps.claim(id, adminId, approve ? 'approved' : 'rejected');
  if (!action) return { outcome: 'not_found' };
  if (!approve) return { outcome: 'rejected' };

  let outcome: { result: string } | { error: string };
  try {
    if (!isActionTool(action.tool)) throw new Error('The saved action names an unknown tool.');
    const args = parseActionArgs(action.tool, action.args);
    outcome = { result: await deps.dispatch(action.tool, args) };
  } catch (err) {
    outcome = { error: err instanceof Error ? err.message : String(err) };
  }

  // The message is already sent or failed. A failure to record it must not hide that.
  await deps.finish(id, outcome).catch((err: unknown) => {
    console.error('[approvals] Could not record the outcome of action', id, err);
  });

  return 'result' in outcome
    ? { outcome: 'executed', result: outcome.result }
    : { outcome: 'failed', error: outcome.error };
}
