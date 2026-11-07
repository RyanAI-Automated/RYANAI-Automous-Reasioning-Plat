import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../pages/commandCenterOperations.ts', import.meta.url), 'utf8');

describe('cloud attachment message persistence ordering', () => {
  it('uses a UUID message ID and persists the message before Storage upload', () => {
    const uuid = source.indexOf('if (client) message.id = crypto.randomUUID();');
    const insert = source.indexOf("client.from('messages').insert({", uuid);
    const upload = source.indexOf('attachments = await uploadConversationAttachments(', insert);
    expect(uuid).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(uuid);
    expect(upload).toBeGreaterThan(insert);
    expect(source.slice(insert, upload)).toContain('id: message.id');
  });

  it('writes attachment metadata only after the upload succeeds', () => {
    const upload = source.indexOf('attachments = await uploadConversationAttachments(');
    const metadata = source.indexOf(".update({ metadata: { attachments } })", upload);
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(metadata).toBeGreaterThan(upload);
  });

  it('rolls back the provisional message when upload or metadata persistence fails', () => {
    const upload = source.indexOf('attachments = await uploadConversationAttachments(');
    const rollback = source.indexOf(".from('messages')\n        .delete()", upload);
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(rollback).toBeGreaterThan(upload);
    expect(source.slice(rollback, rollback + 260)).toContain(".eq('id', message.id)");
    expect(source.slice(rollback, rollback + 260)).toContain(".eq('conversation_id', conversationId)");
  });
});
