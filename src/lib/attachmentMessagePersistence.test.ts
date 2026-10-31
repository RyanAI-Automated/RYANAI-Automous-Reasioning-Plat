import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../pages/CommandCenter.tsx', import.meta.url), 'utf8');

describe('cloud attachment message persistence ordering', () => {
  it('uses a UUID message ID and persists the message before Storage upload', () => {
    const uuid = source.indexOf('if (supabase) userMsg.id = crypto.randomUUID();');
    const insert = source.indexOf(".from('messages').insert({", uuid);
    const upload = source.indexOf('uploadConversationAttachments(supabase, userId, convId, userMsg.id', insert);
    expect(uuid).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(uuid);
    expect(upload).toBeGreaterThan(insert);
    expect(source.slice(insert, upload)).toContain('id: userMsg.id');
  });

  it('writes attachment metadata only after the upload succeeds', () => {
    const upload = source.indexOf('uploadConversationAttachments(supabase, userId, convId, userMsg.id');
    const metadata = source.indexOf(".update({ metadata: { attachments } })", upload);
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(metadata).toBeGreaterThan(upload);
  });

  it('rolls back the provisional message when upload or metadata persistence fails', () => {
    const rollback = source.indexOf(".from('messages')\n            .delete()", source.indexOf('uploadConversationAttachments'));
    expect(rollback).toBeGreaterThan(source.indexOf('uploadConversationAttachments'));
    expect(source.slice(rollback, rollback + 220)).toContain('.eq(\'id\', userMsg.id)');
  });
});
