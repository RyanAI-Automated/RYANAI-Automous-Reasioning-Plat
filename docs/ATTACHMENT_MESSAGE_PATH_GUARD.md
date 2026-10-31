# Attachment message-path guard

Migration: `20261031120000_attachment_message_path_guard.sql`

The existing quota trigger validates the owner and conversation relationship. This additive guard closes the third-segment gap: the message UUID must identify a row in `public.messages` whose `conversation_id` equals the conversation UUID in the object path.

The SECURITY DEFINER trigger is limited to `ryanai-attachments`, uses a fixed search_path, and is not executable by PUBLIC, anon, or authenticated roles. The existing quota trigger remains responsible for owner-to-conversation validation and quotas.

## Staging gate
- Apply after the private attachment foundation and quota migrations in a disposable Supabase project.
- Confirm a valid message path succeeds.
- Confirm nonexistent messages, malformed UUIDs, and messages from another conversation fail.
- Confirm other buckets are unaffected.
- Do not apply to production until two-account Storage API tests and backup/restore rehearsal pass.

## Recovery
Disable attachment uploads before reverting. In disposable staging, rollback with:
`DROP TRIGGER IF EXISTS ryanai_attachment_message_path_guard ON storage.objects;`
`DROP FUNCTION IF EXISTS public.enforce_ryanai_attachment_message_path();`
Preserve object bytes and metadata. Production rollback requires a reviewed backup-backed plan.
