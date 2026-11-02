import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readMigration = (name: string) => readFileSync(
  new URL(`../../supabase/migrations/${name}`, import.meta.url),
  'utf8',
);
const privateStorage = readMigration('20261030120000_private_conversation_attachments.sql');
const quota = readMigration('20261030130000_attachment_quota_enforcement.sql');
const quarantine = readMigration('20261030140000_attachment_malware_scan_quarantine.sql');

describe('private attachment Storage authorization migrations', () => {
  it('keeps the attachment bucket private and binds object owner and conversation to auth.uid()', () => {
    expect(privateStorage).toMatch(/'ryanai-attachments'[\s\S]*?false/);
    for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(privateStorage).toContain(`ON storage.objects FOR ${operation} TO authenticated`);
    }
    expect(privateStorage.match(/storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g)?.length).toBeGreaterThanOrEqual(4);
    expect(privateStorage).toContain('c.user_id = auth.uid()');
  });

  it('validates the three-segment owner/conversation/message path before quota accounting', () => {
    expect(quota).toContain('cardinality(storage.foldername(NEW.name)) <> 3');
    expect(quota).toContain('v_user_text := split_part(NEW.name, \'/\', 1)');
    expect(quota).toContain('v_conversation_text := split_part(NEW.name, \'/\', 2)');
    expect(quota).toContain('v_message_text := split_part(NEW.name, \'/\', 3)');
    expect(quota).toContain('conversation.user_id = v_user_id');
    expect(quota).toContain('BEFORE INSERT ON storage.objects');
  });

  it('makes direct authenticated reads contingent on a clean scan record', () => {
    expect(quarantine).toContain('DROP POLICY IF EXISTS "ryanai_attachment_read_own_conversation"');
    expect(quarantine).toContain('CREATE POLICY "ryanai_attachment_read_clean_own_conversation"');
    expect(quarantine).toContain('s.user_id = auth.uid()');
    expect(quarantine).toContain("s.status = 'clean'");
    expect(quarantine).toContain('ON storage.objects');
  });

  it('does not grant authenticated clients execution of privileged scanner RPCs', () => {
    expect(quarantine).toContain('REVOKE ALL ON FUNCTION public.claim_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated');
    expect(quarantine).toContain('GRANT EXECUTE ON FUNCTION public.claim_ryanai_attachment_scan() TO service_role');
    expect(quarantine).toContain('GRANT EXECUTE ON FUNCTION public.finish_ryanai_attachment_scan(text,text,text,text) TO service_role');
  });
});
