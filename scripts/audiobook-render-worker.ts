import '../src/loadEnv.js';

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAudiobookPrismaClient } from '../src/lib/audiobookPrisma.js';
import { getLanguageName, isRyanLanguage } from '../src/shared/languages.js';

const BUCKET = 'ryanai-audiobooks';
const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);
const MAX_SEGMENT_CHARS = 4_000;
const LEASE_MS = 5 * 60_000;
const POLL_MS = 2_000;
const workerId = `audiobook-${process.env.HOSTNAME || 'worker'}-${randomUUID()}`;

let prisma: ReturnType<typeof createAudiobookPrismaClient> | null = null;
function db() {
  if (!prisma) throw new Error('Audiobook database client is not initialized.');
  return prisma;
}

type RenderChapter = { id: string; title: string; text: string; voice: string; style: string; speed: number };
type RenderRequest = { projectId: string; title: string; language: string; chapters: RenderChapter[] };
type ClaimedJob = { id: string; userId: string; projectId: string; attempts: number; maxAttempts: number; request: RenderRequest };

class PermanentRenderError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to run audiobook rendering.`);
  return value;
}

function splitText(value: string): string[] {
  const chunks: string[] = [];
  let rest = value.trim();
  while (rest.length > MAX_SEGMENT_CHARS) {
    const sample = rest.slice(0, MAX_SEGMENT_CHARS + 1);
    const boundary = Math.max(sample.lastIndexOf('. '), sample.lastIndexOf('! '), sample.lastIndexOf('? '), sample.lastIndexOf(String.fromCharCode(10, 10)));
    const cut = boundary > MAX_SEGMENT_CHARS * 0.45 ? boundary + 1 : sample.lastIndexOf(' ');
    const length = cut > 0 ? cut : MAX_SEGMENT_CHARS;
    chunks.push(rest.slice(0, length).trim());
    rest = rest.slice(length).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function backoff(attempt: number): Date {
  return new Date(Date.now() + Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, attempt - 1))));
}

async function claimJob(): Promise<ClaimedJob | null> {
  await db().$executeRaw`UPDATE audiobook_render_jobs SET status = 'cancelled', worker_id = NULL, locked_at = NULL, lease_expires_at = NULL, completed_at = NOW(), updated_at = NOW(), error = 'Cancellation finalized after worker lease expiry.' WHERE status = 'cancel_requested' AND lease_expires_at < NOW()`;
  await db().$executeRaw`UPDATE audiobook_render_jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END, worker_id = NULL, locked_at = NULL, lease_expires_at = NULL, completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END, updated_at = NOW(), error = 'Worker lease expired; job recovered by queue supervisor.' WHERE status = 'running' AND lease_expires_at < NOW()`;
  const rows = await db().$queryRaw<ClaimedJob[]> `
    UPDATE audiobook_render_jobs
    SET status = 'running',
        worker_id = ${workerId},
        locked_at = NOW(),
        lease_expires_at = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
        attempts = attempts + 1,
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM audiobook_render_jobs
      WHERE cancel_requested_at IS NULL
        AND attempts < max_attempts
        AND next_attempt_at <= NOW()
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id AS "userId", project_id AS "projectId",
      attempts, max_attempts AS "maxAttempts", request
  `;
  return rows[0] ?? null;
}

async function updateProgress(job: ClaimedJob, progress: Record<string, unknown>) {
  const updated = await db().audiobookRenderJob.updateMany({
    where: { id: job.id, workerId, attempts: job.attempts, status: 'running', cancelRequestedAt: null, leaseExpiresAt: { gt: new Date() } },
    data: { progress, lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() },
  });
  if (updated.count !== 1) throw new Error('Render job lease was lost or cancellation was requested.');
}

async function isCancelled(job: ClaimedJob): Promise<boolean> {
  const current = await db().audiobookRenderJob.findUnique({ where: { id: job.id }, select: { status: true, cancelRequestedAt: true, workerId: true, attempts: true } });
  return !current || current.workerId !== workerId || current.attempts !== job.attempts || current.status === 'cancel_requested' || current.cancelRequestedAt !== null;
}

async function renderSegment(text: string, chapter: RenderChapter, language: string, apiKey: string): Promise<Buffer> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice: chapter.voice, input: text,
      instructions: `Narrate in ${getLanguageName(language)} (${language}). ${chapter.style || 'Speak naturally and clearly, with expressive audiobook narration and appropriate pauses.'}`,
      response_format: 'mp3', speed: chapter.speed,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const message = `Speech provider returned HTTP ${response.status}.`;
    if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) throw new PermanentRenderError(message);
    throw new Error(message);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 24 * 1024 * 1024) throw new PermanentRenderError('Speech provider returned an invalid audio segment.');
  return bytes;
}

async function processJob(job: ClaimedJob, storage: ReturnType<typeof createClient>, apiKey: string) {
  const snapshot = job.request;
  if (!snapshot || snapshot.projectId !== job.projectId || typeof snapshot.title !== 'string' || !isRyanLanguage(snapshot.language) || !Array.isArray(snapshot.chapters) || snapshot.chapters.length < 1 || snapshot.chapters.length > 200) {
    throw new PermanentRenderError('Persisted render request is invalid.');
  }
  const artifacts: Array<{ chapterId: string; chapterTitle: string; path: string; mimeType: string }> = [];
  try {
  for (let chapterIndex = 0; chapterIndex < snapshot.chapters.length; chapterIndex += 1) {
    const chapter = snapshot.chapters[chapterIndex];
    if (!chapter || typeof chapter.text !== 'string' || !chapter.text.trim() || chapter.text.length > 200_000 || typeof chapter.title !== 'string' || chapter.title.length > 120 || !VOICES.has(chapter.voice) || typeof chapter.style !== 'string' || chapter.style.length > 500 || !Number.isFinite(chapter.speed) || chapter.speed < 0.8 || chapter.speed > 1.2) {
      throw new PermanentRenderError('A chapter in the render snapshot is invalid.');
    }
    const segments = splitText(chapter.text);
    const rendered: Buffer[] = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (await isCancelled(job)) throw new Error('CANCELLED');
      await updateProgress(job, {
        completedChapters: chapterIndex,
        totalChapters: snapshot.chapters.length,
        currentChapter: chapter.title,
        currentChapterIndex: chapterIndex,
        currentSegment: segmentIndex + 1,
        totalSegments: segments.length,
      });
      rendered.push(await renderSegment(segments[segmentIndex], chapter, snapshot.language, apiKey));
    }
    if (await isCancelled(job)) throw new Error('CANCELLED');
    const path = `${job.userId}/${job.projectId}/${job.id}/chapter-${String(chapterIndex + 1).padStart(4, '0')}.mp3`;
    const { error } = await storage.storage.from(BUCKET).upload(path, Buffer.concat(rendered), {
      contentType: 'audio/mpeg', cacheControl: '0', upsert: true,
    });
    if (error) throw new Error(`Private audio artifact upload failed: ${error.message}`);
    artifacts.push({ chapterId: chapter.id, chapterTitle: chapter.title, path, mimeType: 'audio/mpeg' });
    await updateProgress(job, {
      completedChapters: chapterIndex + 1,
      totalChapters: snapshot.chapters.length,
      currentChapter: chapter.title,
      currentChapterIndex: chapterIndex,
      currentSegment: segments.length,
      totalSegments: segments.length,
    });
  }
  const completed = await db().audiobookRenderJob.updateMany({
    where: { id: job.id, workerId, attempts: job.attempts, status: 'running', cancelRequestedAt: null, leaseExpiresAt: { gt: new Date() } },
    data: {
      status: 'completed', result: { artifacts, projectTitle: snapshot.title, completedAt: new Date().toISOString() },
      error: null, workerId: null, lockedAt: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date(),
      progress: { completedChapters: snapshot.chapters.length, totalChapters: snapshot.chapters.length },
    },
  });
  if (completed.count !== 1) throw new Error('Render job could not commit completion because its lease was lost.');
  } catch (error) {
    if (artifacts.length) {
      const { error: cleanupError } = await storage.storage.from(BUCKET).remove(artifacts.map(artifact => artifact.path));
      if (cleanupError) console.error('[audiobook-worker] partial artifact cleanup failed', { jobId: job.id, count: artifacts.length });
    }
    throw error;
  }
}

async function markCancelled(job: ClaimedJob) {
  await db().audiobookRenderJob.updateMany({
    where: { id: job.id, workerId, attempts: job.attempts, status: 'cancel_requested' },
    data: { status: 'cancelled', workerId: null, lockedAt: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() },
  });
}

async function markFailure(job: ClaimedJob, error: unknown) {
  const current = await db().audiobookRenderJob.findUnique({ where: { id: job.id } });
  if (!current || current.workerId !== workerId || current.attempts !== job.attempts) return;
  const cancelled = current.status === 'cancel_requested' || current.cancelRequestedAt !== null;
  const permanent = error instanceof PermanentRenderError;
  const retry = !cancelled && !permanent && job.attempts < job.maxAttempts;
  await db().audiobookRenderJob.updateMany({
    where: { id: job.id, workerId, attempts: job.attempts },
    data: {
      status: cancelled ? 'cancelled' : retry ? 'queued' : 'failed',
      error: String(error instanceof Error ? error.message : error).slice(0, 1000),
      nextAttemptAt: retry ? backoff(job.attempts) : current.nextAttemptAt,
      workerId: null, lockedAt: null, leaseExpiresAt: null,
      completedAt: cancelled || !retry ? new Date() : null,
      updatedAt: new Date(),
    },
  });
}

async function run() {
  const databaseUrl = required('AUDIOBOOK_DATABASE_URL');
  prisma = createAudiobookPrismaClient(databaseUrl);
  const apiKey = required('OPENAI_API_KEY');
  const storageUrl = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const storage = createClient(storageUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bucket, error: bucketError } = await storage.storage.getBucket(BUCKET);
  if (bucketError || !bucket || bucket.public) {
    throw new Error('A pre-created private ryanai-audiobooks Storage bucket is required.');
  }
  let stopping = false;
  let active = false;

  const processNext = async () => {
    if (stopping || active) return;
    active = true;
    try {
      const job = await claimJob();
      if (!job) return;
      const heartbeat = setInterval(() => {
        void db().audiobookRenderJob.updateMany({
          where: { id: job.id, workerId, attempts: job.attempts, status: 'running', cancelRequestedAt: null, leaseExpiresAt: { gt: new Date() } },
          data: { lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() },
        }).catch(error => console.error('[audiobook-worker] heartbeat failed', error instanceof Error ? error.message : 'unknown'));
      }, Math.floor(LEASE_MS / 3));
      try {
        await processJob(job, storage, apiKey);
        console.info('[audiobook-worker] render job completed', { jobId: job.id });
      } catch (error) {
        if (error instanceof Error && error.message === 'CANCELLED') await markCancelled(job);
        else await markFailure(job, error);
        console.error('[audiobook-worker] render job failed', { jobId: job.id, attempt: job.attempts, message: error instanceof Error ? error.message : 'unknown' });
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      console.error('[audiobook-worker] queue cycle failed', error instanceof Error ? error.message : 'unknown');
    } finally {
      active = false;
    }
  };

  console.info('[audiobook-worker] started', { workerId, pollMs: POLL_MS, leaseMs: LEASE_MS });
  const timer = setInterval(() => void processNext(), POLL_MS);
  void processNext();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    // A running job keeps its lease; the recovery sweep will safely reclaim it after expiry.
    while (active) await new Promise(resolve => setTimeout(resolve, 100));
    await db().$disconnect();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

void run().catch(error => {
  console.error('[audiobook-worker] startup refused', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
