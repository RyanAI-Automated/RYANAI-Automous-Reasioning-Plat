# RyanAI Audiobook Persistence and Render Worker

This worker is an opt-in, separately deployed background process. It does not run inside the API process and does not make a project render merely because a project was saved.

## Required infrastructure

1. Apply the Prisma migrations, including:
   - `20261104200000_audiobook_persistence_jobs`
   - `20261104203000_audiobook_render_request_snapshot`
2. Create a **private** Supabase Storage bucket named `ryanai-audiobooks`. Do not make it public.
3. Configure the worker environment:
   - `DATABASE_URL` — PostgreSQL connection used by Prisma.
   - `OPENAI_API_KEY` — server-only TTS credential. Rendering may incur provider usage charges.
   - `SUPABASE_URL` — Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only storage credential. Never expose it to frontend code or logs.
4. Run `npm run db:generate` after applying the schema changes.
5. Start a dedicated worker process with `npm run worker:audiobook`.

The worker refuses to start if any required credential is missing or if the bucket is absent or public. It does not create infrastructure or change provider subscriptions.

## Job lifecycle

- The authenticated API verifies project ownership and stores an immutable manuscript/voice-settings snapshot before returning HTTP 202.
- An owner-scoped idempotency key prevents duplicate jobs when a client retries the same request.
- PostgreSQL is the queue of record. Workers claim one job atomically using `FOR UPDATE SKIP LOCKED`.
- Jobs use a five-minute lease, heartbeat updates, bounded retries with exponential backoff, progress metadata, and cancellation.
- Expired running leases are reclaimable. Expired cancellation requests are finalized as cancelled.
- Rendered chapter MP3 files are uploaded to private Storage under a path containing the authenticated user, project and job identifiers.
- The API verifies job ownership and artifact path ownership before issuing a five-minute signed download URL.

## Operational controls

- Run the worker as a separate background worker service, not as a serverless request handler.
- Start with one worker replica. PostgreSQL claiming prevents two workers from claiming the same live job.
- Monitor worker logs and queued/running/failed job counts. Never log manuscript text, audio bytes, signed URLs, or provider credentials.
- If a worker is stopped abruptly, the job remains durable and can be reclaimed after its lease expires. A graceful shutdown waits for the active job to finish.
- A missing provider credential, storage bucket, or migration must be treated as a configuration failure, not as a successful render.
- Deleting a project cascades its chapter and job rows. Storage artifact retention/deletion needs a separate, audited cleanup policy before it is enabled.

## Current scope and known limitations

- Jobs currently produce one MP3 artifact per chapter. M4B/ZIP packaging is not part of this worker.
- The worker uses the configured OpenAI TTS endpoint. Fish Audio has not been integrated or verified.
- Voice settings are chapter-level. Word-level annotations and character dialogue switching are not implemented.
- A2T upload transcription and browser S2T dictation remain separate synchronous workflows.
- Tshivenda and other South African language quality remains unverified until native-speaker evaluation is completed.
