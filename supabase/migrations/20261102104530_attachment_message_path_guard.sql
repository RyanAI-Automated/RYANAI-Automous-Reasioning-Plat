-- Bind every uploaded attachment to an existing message in the path's conversation.
CREATE OR REPLACE FUNCTION public.enforce_ryanai_attachment_message_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE v_parts text[]; v_conversation_id uuid; v_message_id uuid;
BEGIN
  IF NEW.bucket_id <> 'ryanai-attachments' THEN RETURN NEW; END IF;
  v_parts := storage.foldername(NEW.name);
  IF cardinality(v_parts) <> 3
     OR v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Attachment path must contain valid owner, conversation, and message IDs' USING ERRCODE = '22023';
  END IF;
  v_conversation_id := v_parts[2]::uuid;
  v_message_id := v_parts[3]::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS message
    WHERE message.id = v_message_id AND message.conversation_id = v_conversation_id
  ) THEN
    RAISE EXCEPTION 'Attachment message does not belong to the path conversation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_ryanai_attachment_message_path() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_attachment_message_path_guard ON storage.objects;
CREATE TRIGGER ryanai_attachment_message_path_guard
BEFORE INSERT ON storage.objects FOR EACH ROW
EXECUTE FUNCTION public.enforce_ryanai_attachment_message_path();
COMMENT ON FUNCTION public.enforce_ryanai_attachment_message_path() IS
  'Requires each private RyanAI attachment object path to reference an existing message in the specified conversation.';
