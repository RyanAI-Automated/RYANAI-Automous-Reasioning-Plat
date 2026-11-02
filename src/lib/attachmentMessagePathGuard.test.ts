import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const migration = readFileSync(new URL('../../supabase/migrations/20261031120000_attachment_message_path_guard.sql', import.meta.url), 'utf8');
describe('attachment message-path ownership guard', () => {
  it('requires valid owner, conversation, and message path segments', () => {
    expect(migration).toContain('cardinality(v_parts) <> 3');
    for (const segment of ['v_parts[1]', 'v_parts[2]', 'v_parts[3]']) expect(migration).toContain(segment + ' !~*');
  });
  it('requires the referenced message to belong to the path conversation', () => {
    expect(migration).toContain('message.id = v_message_id');
    expect(migration).toContain('message.conversation_id = v_conversation_id');
  });
  it('guards Storage inserts and keeps execution away from client roles', () => {
    expect(migration).toContain('BEFORE INSERT ON storage.objects');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.enforce_ryanai_attachment_message_path() FROM PUBLIC, anon, authenticated');
  });
});
