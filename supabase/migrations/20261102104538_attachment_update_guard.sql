-- Close the UPDATE/UPSERT gap in the attachment security boundary.
-- Revalidate paths and quotas on every object write, and requeue malware scans
-- whenever an existing object is replaced or modified.
CREATE OR REPLACE FUNCTION public.enforce_ryanai_attachment_quotas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE
  v_user_text text;
  v_conversation_text text;
  v_message_text text;
  v_user_id uuid;
  v_conversation_id uuid;
  v_file_size bigint;
  v_user_bytes bigint;
  v_message_bytes bigint;
  v_message_files bigint;
  v_hourly_uploads bigint;
  v_exclude_name text := NULL;
BEGIN
  IF NEW.bucket_id <> 'ryanai-attachments' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_exclude_name := OLD.name;
  END IF;

  IF cardinality(storage.foldername(NEW.name)) <> 3 THEN
    RAISE EXCEPTION 'Attachment path must include user, conversation, and message IDs'
      USING ERRCODE = '22023';
  END IF;

  v_user_text := split_part(NEW.name, '/', 1);
  v_conversation_text := split_part(NEW.name, '/', 2);
  v_message_text := split_part(NEW.name, '/', 3);

  IF v_user_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_conversation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_message_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Attachment path contains an invalid owner or resource ID'
      USING ERRCODE = '22023';
  END IF;

  v_user_id := v_user_text::uuid;
  v_conversation_id := v_conversation_text::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = v_conversation_id
      AND conversation.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Attachment conversation does not belong to the path owner'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.metadata->>'size', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Storage did not provide a valid attachment size'
      USING ERRCODE = '22023';
  END IF;
  v_file_size := (NEW.metadata->>'size')::bigint;

  IF v_file_size <= 0 OR v_file_size > 20 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Attachment exceeds the 20 MiB per-file limit'
      USING ERRCODE = '54000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  DELETE FROM public.ryanai_attachment_upload_events
  WHERE user_id = v_user_id
    AND created_at < now() - interval '48 hours';

  SELECT count(*) INTO v_hourly_uploads
  FROM public.ryanai_attachment_upload_events
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 hour';

  IF v_hourly_uploads >= 100 THEN
    RAISE EXCEPTION 'Attachment upload rate limit exceeded (100 uploads per hour)'
      USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(sum(
    CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END
  ), 0)
  INTO v_user_bytes
  FROM storage.objects
  WHERE bucket_id = 'ryanai-attachments'
    AND split_part(name, '/', 1) = v_user_text
    AND (v_exclude_name IS NULL OR name <> v_exclude_name);

  IF v_user_bytes + v_file_size > 500 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Account attachment storage quota exceeded (500 MiB)'
      USING ERRCODE = '54000';
  END IF;

  SELECT count(*), COALESCE(sum(
    CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END
  ), 0)
  INTO v_message_files, v_message_bytes
  FROM storage.objects
  WHERE bucket_id = 'ryanai-attachments'
    AND split_part(name, '/', 1) = v_user_text
    AND split_part(name, '/', 2) = v_conversation_text
    AND split_part(name, '/', 3) = v_message_text
    AND (v_exclude_name IS NULL OR name <> v_exclude_name);

  IF v_message_files >= 8 THEN
    RAISE EXCEPTION 'Message attachment count limit exceeded (8 files)'
      USING ERRCODE = '54000';
  END IF;

  IF v_message_bytes + v_file_size > 40 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Message attachment size limit exceeded (40 MiB)'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.ryanai_attachment_upload_events (user_id) VALUES (v_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ryanai_attachment_quota_guard ON storage.objects;
CREATE TRIGGER ryanai_attachment_quota_guard
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enforce_ryanai_attachment_quotas();

-- An update/upsert must not move an object outside a valid owner/conversation/message path.
DROP TRIGGER IF EXISTS ryanai_attachment_message_path_guard ON storage.objects;
CREATE TRIGGER ryanai_attachment_message_path_guard
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enforce_ryanai_attachment_message_path();

-- Replaced bytes must be scanned again. Pending is unreadable under the existing SELECT policy.
DROP TRIGGER IF EXISTS ryanai_attachment_scan_enqueue ON storage.objects;
CREATE TRIGGER ryanai_attachment_scan_enqueue
AFTER INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ryanai_attachment_scan();

COMMENT ON FUNCTION public.enforce_ryanai_attachment_quotas() IS
  'Enforces attachment path validation and per-file, per-message, per-account, and per-hour quotas for inserts and updates.';
