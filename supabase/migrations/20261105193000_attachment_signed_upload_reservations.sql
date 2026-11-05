-- Signed-upload reservations are inserted before Storage knows the final byte size.
-- Count and validate the reservation, then enforce byte quotas on the final UPDATE.
-- Do not enqueue malware scanning until final object metadata is available.

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
  v_file_size_text text;
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  DELETE FROM public.ryanai_attachment_upload_events
  WHERE user_id = v_user_id
    AND created_at < now() - interval '48 hours';

  SELECT count(*) INTO v_hourly_uploads
  FROM public.ryanai_attachment_upload_events
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 hour';

  IF TG_OP = 'INSERT' AND v_hourly_uploads >= 100 THEN
    RAISE EXCEPTION 'Attachment upload rate limit exceeded (100 uploads per hour)'
      USING ERRCODE = '54000';
  END IF;

  v_file_size_text := NULLIF(btrim(NEW.metadata->>'size'), '');
  IF v_file_size_text IS NULL THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Final attachment upload is missing byte-size metadata'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_message_files
    FROM storage.objects
    WHERE bucket_id = 'ryanai-attachments'
      AND split_part(name, '/', 1) = v_user_text
      AND split_part(name, '/', 2) = v_conversation_text
      AND split_part(name, '/', 3) = v_message_text;

    IF v_message_files >= 8 THEN
      RAISE EXCEPTION 'Message attachment count limit exceeded (8 files)'
        USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.ryanai_attachment_upload_events (user_id) VALUES (v_user_id);
    RETURN NEW;
  END IF;

  IF v_file_size_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Storage provided invalid attachment size metadata'
      USING ERRCODE = '22023';
  END IF;
  v_file_size := v_file_size_text::bigint;

  IF v_file_size <= 0 OR v_file_size > 20 * 1024 * 1024 THEN
    RAISE EXCEPTION 'Attachment exceeds the 20 MiB per-file limit'
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

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ryanai_attachment_upload_events (user_id) VALUES (v_user_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_ryanai_attachment_quotas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_attachment_quota_guard ON storage.objects;
CREATE TRIGGER ryanai_attachment_quota_guard
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enforce_ryanai_attachment_quotas();

-- Comms reservations carry expected size in server-owned metadata. A signed-upload
-- reservation may omit the Storage size, but final upload must match the reservation.
CREATE OR REPLACE FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE
  p text[];
  u uuid;
  c text;
  m text;
  v_expected_size bigint;
  v_file_size_text text;
  v_file_size bigint;
  v_user_bytes bigint;
  v_message_bytes bigint;
  v_message_files bigint;
  v_hourly_uploads bigint;
  v_exclude_name text := NULL;
BEGIN
  IF NEW.bucket_id <> 'ryanai-comms-attachments' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_exclude_name := OLD.name;
  END IF;

  p := storage.foldername(NEW.name);
  IF cardinality(p) <> 3
     OR p[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid Comms attachment path' USING ERRCODE = '22023';
  END IF;

  u := p[1]::uuid;
  c := p[2];
  m := p[3];

  IF NOT EXISTS (
    SELECT 1 FROM public.communication_conversations
    WHERE id = c AND owner_user_id = u
  ) THEN
    RAISE EXCEPTION 'Comms owner/conversation mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.communication_messages
    WHERE id = m AND conversation_id = c
  ) THEN
    RAISE EXCEPTION 'Comms message/conversation mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT size INTO v_expected_size
  FROM public.communication_attachments
  WHERE object_name = NEW.name
    AND owner_user_id = u
    AND communication_message_id = m
    AND bucket_id = NEW.bucket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comms metadata reservation missing' USING ERRCODE = '42501';
  END IF;

  IF v_expected_size <= 0 OR v_expected_size > 20971520 THEN
    RAISE EXCEPTION 'Comms attachment reservation exceeds the 20 MiB file limit'
      USING ERRCODE = '54000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(u::text, 0));

  DELETE FROM public.ryanai_attachment_upload_events
  WHERE user_id = u AND created_at < now() - interval '48 hours';

  SELECT count(*) INTO v_hourly_uploads
  FROM public.ryanai_attachment_upload_events
  WHERE user_id = u AND created_at >= now() - interval '1 hour';

  IF TG_OP = 'INSERT' AND v_hourly_uploads >= 100 THEN
    RAISE EXCEPTION 'Comms upload rate limit exceeded' USING ERRCODE = '54000';
  END IF;

  v_file_size_text := NULLIF(btrim(NEW.metadata->>'size'), '');
  IF v_file_size_text IS NULL THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Final Comms upload is missing byte-size metadata' USING ERRCODE = '22023';
    END IF;
    v_file_size := v_expected_size;
  ELSE
    IF v_file_size_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Storage provided invalid Comms size metadata' USING ERRCODE = '22023';
    END IF;
    v_file_size := v_file_size_text::bigint;
    IF v_file_size <> v_expected_size THEN
      RAISE EXCEPTION 'Uploaded Comms file size does not match its reservation' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_file_size <= 0 OR v_file_size > 20971520 THEN
    RAISE EXCEPTION 'File exceeds 20 MiB' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(sum(size), 0) INTO v_user_bytes
  FROM public.communication_attachments
  WHERE owner_user_id = u
    AND bucket_id = NEW.bucket_id
    AND object_name <> NEW.name
    AND (v_exclude_name IS NULL OR object_name <> v_exclude_name);

  IF v_user_bytes + v_file_size > 524288000 THEN
    RAISE EXCEPTION 'Comms owner quota exceeded' USING ERRCODE = '54000';
  END IF;

  SELECT count(*), COALESCE(sum(size), 0)
  INTO v_message_files, v_message_bytes
  FROM public.communication_attachments
  WHERE owner_user_id = u
    AND bucket_id = NEW.bucket_id
    AND communication_message_id = m
    AND object_name <> NEW.name
    AND (v_exclude_name IS NULL OR object_name <> v_exclude_name);

  IF v_message_files >= 8 OR v_message_bytes + v_file_size > 41943040 THEN
    RAISE EXCEPTION 'Comms per-message quota exceeded' USING ERRCODE = '54000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ryanai_attachment_upload_events(user_id) VALUES (u);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_path_and_quota ON storage.objects;
CREATE TRIGGER ryanai_comms_attachment_path_and_quota
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota();

-- Only finalized object rows are scanned. Updates trigger a rescan after an upsert.
CREATE OR REPLACE FUNCTION public.enqueue_ryanai_attachment_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner text;
  v_size_text text;
BEGIN
  IF NEW.bucket_id <> 'ryanai-attachments' THEN
    RETURN NEW;
  END IF;
  v_size_text := NEW.metadata->>'size';
  IF COALESCE(v_size_text, '') !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  IF v_size_text::bigint <= 0 THEN
    RETURN NEW;
  END IF;

  v_owner := split_part(NEW.name, '/', 1);
  IF v_owner !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid attachment owner path' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ryanai_attachment_scans (bucket_id, object_name, user_id)
  VALUES (NEW.bucket_id, NEW.name, v_owner::uuid)
  ON CONFLICT (bucket_id, object_name) DO UPDATE
    SET status = 'pending', attempts = 0, last_error = NULL,
        updated_at = now(), scanned_at = NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ryanai_attachment_scan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_attachment_scan_enqueue ON storage.objects;
CREATE TRIGGER ryanai_attachment_scan_enqueue
AFTER INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ryanai_attachment_scan();

CREATE OR REPLACE FUNCTION public.enqueue_ryanai_comms_attachment_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_size_text text;
BEGIN
  IF NEW.bucket_id <> 'ryanai-comms-attachments' THEN
    RETURN NEW;
  END IF;
  v_size_text := NEW.metadata->>'size';
  IF COALESCE(v_size_text, '') !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  IF v_size_text::bigint <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ryanai_attachment_scans(bucket_id, object_name, user_id)
  VALUES (NEW.bucket_id, NEW.name, split_part(NEW.name, '/', 1)::uuid)
  ON CONFLICT (bucket_id, object_name) DO UPDATE
    SET status = 'pending', attempts = 0, last_error = NULL,
        updated_at = now(), scanned_at = NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ryanai_comms_attachment_scan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_scan_enqueue ON storage.objects;
CREATE TRIGGER ryanai_comms_attachment_scan_enqueue
AFTER INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ryanai_comms_attachment_scan();
