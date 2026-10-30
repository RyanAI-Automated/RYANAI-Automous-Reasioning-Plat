-- Private, account-scoped conversation attachments.
-- Objects are stored under: <auth-user-id>/<conversation-id>/<message-id>/<random-id>-<filename>
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ryanai-attachments',
  'ryanai-attachments',
  false,
  20971520,
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp',
    'video/mp4','video/webm',
    'audio/mpeg','audio/wav','audio/ogg','audio/mp4',
    'application/pdf','text/plain','text/markdown','text/csv','application/json','application/xml',
    'text/javascript','text/typescript','text/x-python','text/x-go','text/x-rust','text/x-java','text/html','text/css',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "ryanai_attachment_read_own_conversation" ON storage.objects;
CREATE POLICY "ryanai_attachment_read_own_conversation"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ryanai-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "ryanai_attachment_insert_own_conversation" ON storage.objects;
CREATE POLICY "ryanai_attachment_insert_own_conversation"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ryanai-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "ryanai_attachment_update_own_conversation" ON storage.objects;
CREATE POLICY "ryanai_attachment_update_own_conversation"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'ryanai-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'ryanai-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "ryanai_attachment_delete_own_conversation" ON storage.objects;
CREATE POLICY "ryanai_attachment_delete_own_conversation"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ryanai-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.user_id = auth.uid()
  )
);
