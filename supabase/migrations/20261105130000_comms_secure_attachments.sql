-- Dedicated private Comms bucket. No browser Storage policies are created.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('ryanai-comms-attachments','ryanai-comms-attachments',false,20971520,ARRAY['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/mp4','application/pdf','text/plain','text/markdown','text/csv','application/json','application/xml','text/javascript','text/typescript','text/x-python','text/x-go','text/x-rust','text/x-java','text/css','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip']::text[])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE OR REPLACE FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,storage AS $$
DECLARE p text[]; u uuid; c text; m text; sz bigint; ub bigint; mb bigint; mf bigint; hr bigint;
BEGIN
 IF NEW.bucket_id<>'ryanai-comms-attachments' THEN RETURN NEW; END IF;
 p:=storage.foldername(NEW.name);
 IF cardinality(p)<>3 OR p[1]!~*'^[0-9a-f-]{36}$' OR p[2]!~*'^[0-9a-f-]{36}$' OR p[3]!~*'^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid Comms attachment path' USING ERRCODE='22023'; END IF;
 u:=p[1]::uuid;c:=p[2];m:=p[3];
 IF NOT EXISTS(SELECT 1 FROM public.communication_conversations WHERE id=c AND owner_user_id=u) THEN RAISE EXCEPTION 'Comms owner/conversation mismatch' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_messages WHERE id=m AND conversation_id=c) THEN RAISE EXCEPTION 'Comms message/conversation mismatch' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_attachments WHERE object_name=NEW.name AND owner_user_id=u AND communication_message_id=m AND bucket_id=NEW.bucket_id) THEN RAISE EXCEPTION 'Comms metadata reservation missing' USING ERRCODE='42501'; END IF;
 IF COALESCE(NEW.metadata->>'size','')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Storage size metadata missing' USING ERRCODE='22023'; END IF;
 sz:=(NEW.metadata->>'size')::bigint;IF sz<=0 OR sz>20971520 THEN RAISE EXCEPTION 'File exceeds 20 MiB' USING ERRCODE='54000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text,0));
 DELETE FROM public.ryanai_attachment_upload_events WHERE user_id=u AND created_at<now()-interval '48 hours';
 SELECT count(*) INTO hr FROM public.ryanai_attachment_upload_events WHERE user_id=u AND created_at>=now()-interval '1 hour';
 IF hr>=100 THEN RAISE EXCEPTION 'Comms upload rate limit exceeded' USING ERRCODE='54000';END IF;
 SELECT COALESCE(sum((metadata->>'size')::bigint),0) INTO ub FROM storage.objects WHERE bucket_id=NEW.bucket_id AND split_part(name,'/',1)=u::text AND COALESCE(metadata->>'size','')~'^[0-9]+$';
 IF ub+sz>524288000 THEN RAISE EXCEPTION 'Comms owner quota exceeded' USING ERRCODE='54000';END IF;
 SELECT count(*),COALESCE(sum((metadata->>'size')::bigint),0) INTO mf,mb FROM storage.objects WHERE bucket_id=NEW.bucket_id AND split_part(name,'/',1)=u::text AND split_part(name,'/',2)=c AND split_part(name,'/',3)=m AND COALESCE(metadata->>'size','')~'^[0-9]+$';
 IF mf>=8 OR mb+sz>41943040 THEN RAISE EXCEPTION 'Comms per-message quota exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO public.ryanai_attachment_upload_events(user_id) VALUES(u);RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_path_and_quota ON storage.objects;
CREATE TRIGGER ryanai_comms_attachment_path_and_quota BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.enforce_ryanai_comms_attachment_path_and_quota();
CREATE OR REPLACE FUNCTION public.enqueue_ryanai_comms_attachment_scan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.bucket_id<>'ryanai-comms-attachments' THEN RETURN NEW; END IF;
 INSERT INTO public.ryanai_attachment_scans(bucket_id,object_name,user_id) VALUES(NEW.bucket_id,NEW.name,split_part(NEW.name,'/',1)::uuid)
 ON CONFLICT(bucket_id,object_name) DO UPDATE SET status='pending',attempts=0,last_error=NULL,updated_at=now(),scanned_at=NULL;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.enqueue_ryanai_comms_attachment_scan() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_scan_enqueue ON storage.objects;
CREATE TRIGGER ryanai_comms_attachment_scan_enqueue AFTER INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.enqueue_ryanai_comms_attachment_scan();
CREATE OR REPLACE FUNCTION public.claim_ryanai_orphan_attachment_cleanup(p_created_before timestamptz,p_limit integer DEFAULT 100)
RETURNS TABLE(id bigint,bucket_id text,object_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_created_before IS NULL OR p_created_before>now()-interval '1 day' THEN RAISE EXCEPTION 'Orphan cutoff must be at least one day old' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH candidates AS (
  SELECT s.id FROM public.ryanai_attachment_scans s
  WHERE s.bucket_id IN('ryanai-attachments','ryanai-comms-attachments') AND s.status<>'infected' AND s.orphan_purged_at IS NULL AND s.created_at<p_created_before AND s.orphan_cleanup_attempts<5
  AND (s.orphan_cleanup_last_attempt_at IS NULL OR s.orphan_cleanup_last_attempt_at<now()-interval '6 hours')
  AND split_part(s.object_name,'/',1)=s.user_id::text
  AND ((s.bucket_id='ryanai-attachments' AND NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.id::text=split_part(s.object_name,'/',3) AND m.conversation_id::text=split_part(s.object_name,'/',2)))
    OR (s.bucket_id='ryanai-comms-attachments' AND NOT EXISTS(SELECT 1 FROM public.communication_messages m WHERE m.id=split_part(s.object_name,'/',3) AND m.conversation_id=split_part(s.object_name,'/',2))))
  ORDER BY s.created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100)
 )
 UPDATE public.ryanai_attachment_scans s SET orphan_cleanup_attempts=s.orphan_cleanup_attempts+1,orphan_cleanup_last_attempt_at=now(),orphan_cleanup_last_error=NULL FROM candidates c WHERE s.id=c.id RETURNING s.id,s.bucket_id,s.object_name;
END;$$;
REVOKE ALL ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ryanai_orphan_attachment_cleanup(timestamptz,integer) TO service_role;


-- Attachment metadata is server-only. Browser clients receive only one-use
-- Storage upload tokens and short-lived signed reads through the owner API.
CREATE TABLE IF NOT EXISTS public.communication_attachment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_attachment_id TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  event TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS communication_attachment_audit_attachment_created_idx
  ON public.communication_attachment_audit (communication_attachment_id, created_at);
CREATE INDEX IF NOT EXISTS communication_attachment_audit_owner_created_idx
  ON public.communication_attachment_audit (owner_user_id, created_at);

ALTER TABLE public.communication_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_attachment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.communication_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.communication_attachment_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.communication_attachments TO service_role;
GRANT ALL ON TABLE public.communication_attachment_audit TO service_role;

CREATE OR REPLACE FUNCTION public.audit_ryanai_comms_attachment_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.communication_attachment_audit
    (communication_attachment_id, owner_user_id, event, metadata)
  VALUES
    (NEW.id, NEW.owner_user_id, 'attachment_reserved',
     jsonb_build_object('bucket_id', NEW.bucket_id, 'source', NEW.source, 'mime_type', NEW.mime_type, 'size', NEW.size));
  RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.audit_ryanai_comms_attachment_reservation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_reservation_audit ON public.communication_attachments;
CREATE TRIGGER ryanai_comms_attachment_reservation_audit
AFTER INSERT ON public.communication_attachments
FOR EACH ROW EXECUTE FUNCTION public.audit_ryanai_comms_attachment_reservation();

CREATE OR REPLACE FUNCTION public.audit_ryanai_comms_attachment_scan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_attachment_id TEXT;
  v_owner_user_id UUID;
  v_event TEXT;
BEGIN
  IF NEW.bucket_id <> 'ryanai-comms-attachments' THEN RETURN NEW; END IF;
  SELECT id, owner_user_id INTO v_attachment_id, v_owner_user_id
  FROM public.communication_attachments
  WHERE object_name = NEW.object_name
  LIMIT 1;
  IF v_attachment_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_event := 'scan_queued';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event := CASE NEW.status
      WHEN 'scanning' THEN 'scan_started'
      WHEN 'clean' THEN 'scan_clean'
      WHEN 'infected' THEN 'scan_infected'
      WHEN 'failed' THEN 'scan_failed'
      ELSE 'scan_state_changed'
    END;
  ELSIF NEW.purged_at IS DISTINCT FROM OLD.purged_at AND NEW.purged_at IS NOT NULL THEN
    v_event := 'quarantine_purged';
  ELSIF NEW.orphan_purged_at IS DISTINCT FROM OLD.orphan_purged_at AND NEW.orphan_purged_at IS NOT NULL THEN
    v_event := 'orphan_purged';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.communication_attachment_audit
    (communication_attachment_id, owner_user_id, event, metadata)
  VALUES
    (v_attachment_id, v_owner_user_id, v_event,
     jsonb_build_object('bucket_id', NEW.bucket_id, 'status', NEW.status, 'attempts', NEW.attempts));
  RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.audit_ryanai_comms_attachment_scan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ryanai_comms_attachment_scan_audit ON public.ryanai_attachment_scans;
CREATE TRIGGER ryanai_comms_attachment_scan_audit
AFTER INSERT OR UPDATE ON public.ryanai_attachment_scans
FOR EACH ROW EXECUTE FUNCTION public.audit_ryanai_comms_attachment_scan();
