import { describe, expect, it } from 'vitest';
import { createCommsDispatchApprovalDigest } from './dispatchApproval.js';

const base = {
  ownerUserId: 'owner-1',
  channel: 'whatsapp',
  recipient: '+27820000000',
  deliveryBody: 'Hello',
  emailSubject: 'RyanAI notification',
  approvedTemplateSid: null,
  contentVariables: null,
  idempotencyKey: 'comms-test-idempotency-0001',
  attachmentIds: ['attachment-1'],
};

describe('Comms dispatch approval digest', () => {
  it('is stable for the same exact action', () => {
    expect(createCommsDispatchApprovalDigest(base)).toBe(createCommsDispatchApprovalDigest({ ...base }));
  });

  it('binds approval to owner, channel, recipient, body, subject, template, idempotency and attachments', () => {
    const digest = createCommsDispatchApprovalDigest(base);
    for (const change of [
      { ownerUserId: 'owner-2' },
      { channel: 'sms' },
      { recipient: '+27820000001' },
      { deliveryBody: 'Changed body' },
      { emailSubject: 'Changed subject' },
      { approvedTemplateSid: 'HX-template' },
      { contentVariables: '{"1":"changed"}' },
      { idempotencyKey: 'comms-test-idempotency-0002' },
      { attachmentIds: ['attachment-2'] },
    ]) {
      expect(createCommsDispatchApprovalDigest({ ...base, ...change })).not.toBe(digest);
    }
  });

  it('normalizes email recipients before hashing', () => {
    expect(createCommsDispatchApprovalDigest({ ...base, channel: 'email', recipient: ' OWNER@example.com ' }))
      .toBe(createCommsDispatchApprovalDigest({ ...base, channel: 'email', recipient: 'owner@example.com' }));
  });
});
