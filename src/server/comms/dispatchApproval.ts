import { createHash } from 'node:crypto';

export interface CommsDispatchApprovalInput {
  ownerUserId: string;
  channel: string;
  recipient: string;
  deliveryBody: string;
  emailSubject: string;
  approvedTemplateSid: string | null;
  contentVariables: string | null;
  idempotencyKey: string;
  attachmentIds: string[];
}

/** Stable, owner-bound digest for the exact outbound action being approved. */
export function createCommsDispatchApprovalDigest(input: CommsDispatchApprovalInput): string {
  const canonical = JSON.stringify({
    ownerUserId: input.ownerUserId,
    channel: input.channel,
    recipient: input.channel === 'email' ? input.recipient.trim().toLowerCase() : input.recipient.trim(),
    deliveryBody: input.deliveryBody,
    emailSubject: input.emailSubject,
    approvedTemplateSid: input.approvedTemplateSid,
    contentVariables: input.contentVariables,
    idempotencyKey: input.idempotencyKey,
    attachmentIds: [...input.attachmentIds],
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
