import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';
import { isRyanLanguage } from '../../shared/languages.js';

const BUCKET = 'ryanai-audiobooks';
const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);
const MAX_CHAPTERS = 200;
const MAX_CHAPTER_CHARS = 200_000;
const MAX_BOOK_CHARS = 300_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChapterInput = { id?: string; title: string; text: string; voice?: string; style?: string; speed?: number };
type ProjectInput = { title?: string; language?: string; chapters?: ChapterInput[] };

function validateProject(body: ProjectInput): { title: string; language: string; chapters: Array<{ id?: string; title: string; content: string; position: number; narrationSettings: { voice: string; style: string; speed: number } }> } | null {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const language = typeof body.language === 'string' ? body.language : 'en-ZA';
  if (!title || title.length > 120 || !isRyanLanguage(language) || !Array.isArray(body.chapters) || body.chapters.length < 1 || body.chapters.length > MAX_CHAPTERS) return null;
  let total = 0;
  const chapters: Array<{ id?: string; title: string; content: string; position: number; narrationSettings: { voice: string; style: string; speed: number } }> = [];
  const chapterIds = new Set<string>();
  for (let index = 0; index < body.chapters.length; index += 1) {
    const chapter = body.chapters[index];
    if (!chapter || typeof chapter.title !== 'string' || !chapter.title.trim() || chapter.title.length > 120 || typeof chapter.text !== 'string' || chapter.text.length > MAX_CHAPTER_CHARS) return null;
    const voice = typeof chapter.voice === 'string' ? chapter.voice : 'coral';
    const style = typeof chapter.style === 'string' ? chapter.style : '';
    const speed = typeof chapter.speed === 'number' ? chapter.speed : 1;
    if (!VOICES.has(voice) || style.length > 500 || !Number.isFinite(speed) || speed < 0.8 || speed > 1.2) return null;
    total += chapter.text.length;
    if (total > MAX_BOOK_CHARS) return null;
    const id = typeof chapter.id === 'string' && UUID.test(chapter.id) ? chapter.id : undefined;
    if (id && chapterIds.has(id)) return null;
    if (id) chapterIds.add(id);
    chapters.push({ ...(id ? { id } : {}), title: chapter.title.trim(), content: chapter.text, position: index, narrationSettings: { voice, style, speed } });
  }
  return { title, language, chapters };
}

function jobSummary(job: { id: string; status: string; progress: unknown; error: string | null; attempts: number; maxAttempts: number; createdAt: Date; updatedAt: Date; completedAt: Date | null }) {
  return {
    id: job.id, status: job.status, progress: job.progress, error: job.error,
    attempts: job.attempts, maxAttempts: job.maxAttempts,
    createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
  };
}

function getStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const audiobookProjectRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/audiobooks', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const projects = await fastify.prisma.audiobookProject.findMany({
      where: { userId }, orderBy: { updatedAt: 'desc' }, take: 1,
      include: { chapters: { orderBy: { position: 'asc' } } },
    });
    return { projects };
  });

  fastify.post<{ Body: ProjectInput }>('/api/v1/audiobooks', { bodyLimit: 3 * 1024 * 1024, preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const input = validateProject(request.body ?? {});
    if (!input) return reply.code(400).send({ error: 'Project title, language and 1–200 valid chapters are required.' });
    const project = await fastify.prisma.audiobookProject.create({
      data: { userId, title: input.title, language: input.language, chapters: { create: input.chapters } },
      include: { chapters: { orderBy: { position: 'asc' } } },
    });
    return reply.code(201).send({ project });
  });

  fastify.get<{ Params: { projectId: string } }>('/api/v1/audiobooks/:projectId', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const project = await fastify.prisma.audiobookProject.findFirst({
      where: { id: request.params.projectId, userId },
      include: { chapters: { orderBy: { position: 'asc' } } },
    });
    if (!project) return reply.code(404).send({ error: 'Audiobook project not found.' });
    return { project };
  });

  fastify.put<{ Params: { projectId: string }; Body: ProjectInput }>('/api/v1/audiobooks/:projectId', { bodyLimit: 3 * 1024 * 1024, preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const input = validateProject(request.body ?? {});
    if (!input) return reply.code(400).send({ error: 'Project title, language and 1–200 valid chapters are required.' });
    const exists = await fastify.prisma.audiobookProject.findFirst({ where: { id: request.params.projectId, userId }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: 'Audiobook project not found.' });
    const project = await fastify.prisma.$transaction(async (tx) => {
      await tx.audiobookProject.update({ where: { id: exists.id }, data: { title: input.title, language: input.language } });
      await tx.audiobookChapter.deleteMany({ where: { projectId: exists.id } });
      await tx.audiobookChapter.createMany({ data: input.chapters.map(chapter => ({ ...chapter, projectId: exists.id })) });
      return tx.audiobookProject.findUnique({ where: { id: exists.id }, include: { chapters: { orderBy: { position: 'asc' } } } });
    });
    return { project };
  });

  fastify.post<{ Params: { projectId: string }; Body: { idempotencyKey?: string } }>('/api/v1/audiobooks/:projectId/render', {
    preHandler: requireUser,
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!process.env.OPENAI_API_KEY?.trim()) return reply.code(503).send({ error: 'Audiobook rendering is not configured on this server.' });
    if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return reply.code(503).send({ error: 'Private audiobook storage is not configured on this server.' });
    const project = await fastify.prisma.audiobookProject.findFirst({
      where: { id: request.params.projectId, userId }, include: { chapters: { orderBy: { position: 'asc' } } },
    });
    if (!project) return reply.code(404).send({ error: 'Audiobook project not found.' });
    if (!project.chapters.length || project.chapters.some(chapter => !chapter.content.trim())) return reply.code(400).send({ error: 'Every chapter needs manuscript text before rendering.' });
    if (request.body?.idempotencyKey !== undefined && (typeof request.body.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(request.body.idempotencyKey))) {
      return reply.code(400).send({ error: 'The render idempotency key must be 8–120 safe characters.' });
    }
    const idempotencyKey = request.body?.idempotencyKey ?? randomUUID();
    const snapshot = {
      projectId: project.id, title: project.title, language: project.language,
      chapters: project.chapters.map(chapter => {
        const settings = chapter.narrationSettings && typeof chapter.narrationSettings === 'object' ? chapter.narrationSettings as Record<string, unknown> : {};
        const voice = typeof settings.voice === 'string' && VOICES.has(settings.voice) ? settings.voice : 'coral';
        const style = typeof settings.style === 'string' ? settings.style.slice(0, 500) : '';
        const speed = typeof settings.speed === 'number' && Number.isFinite(settings.speed) && settings.speed >= 0.8 && settings.speed <= 1.2 ? settings.speed : 1;
        return { id: chapter.id, title: chapter.title, text: chapter.content, voice, style, speed };
      }),
    };
    const existing = await fastify.prisma.audiobookRenderJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return reply.code(200).send({ job: jobSummary(existing), reused: true });
    const activeJob = await fastify.prisma.audiobookRenderJob.findFirst({
      where: { userId, projectId: project.id, status: { in: ['queued', 'running', 'cancel_requested'] } },
    });
    if (activeJob) return reply.code(409).send({ error: 'Another render is already active for this project.', jobId: activeJob.id });
    try {
      const job = await fastify.prisma.audiobookRenderJob.create({
        data: { userId, projectId: project.id, idempotencyKey, request: snapshot, progress: { completedChapters: 0, totalChapters: project.chapters.length } },
      });
      return reply.code(202).send({ job: jobSummary(job), reused: false });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        const job = await fastify.prisma.audiobookRenderJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (job) return reply.code(200).send({ job: jobSummary(job), reused: true });
        const active = await fastify.prisma.audiobookRenderJob.findFirst({
          where: { userId, projectId: project.id, status: { in: ['queued', 'running', 'cancel_requested'] } },
        });
        if (active) return reply.code(409).send({ error: 'Another render is already active for this project.', jobId: active.id });
      }
      throw error;
    }
  });

  fastify.get<{ Params: { jobId: string } }>('/api/v1/audiobook-jobs/:jobId', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const job = await fastify.prisma.audiobookRenderJob.findFirst({ where: { id: request.params.jobId, userId } });
    if (!job) return reply.code(404).send({ error: 'Audiobook render job not found.' });
    return { job: jobSummary(job) };
  });

  fastify.post<{ Params: { jobId: string } }>('/api/v1/audiobook-jobs/:jobId/cancel', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const queued = await fastify.prisma.audiobookRenderJob.updateMany({
      where: { id: request.params.jobId, userId, status: 'queued' },
      data: { status: 'cancelled', cancelRequestedAt: new Date(), completedAt: new Date() },
    });
    if (queued.count) return { status: 'cancelled' };
    const running = await fastify.prisma.audiobookRenderJob.updateMany({
      where: { id: request.params.jobId, userId, status: 'running' },
      data: { status: 'cancel_requested', cancelRequestedAt: new Date() },
    });
    if (running.count) return { status: 'cancel_requested' };
    const job = await fastify.prisma.audiobookRenderJob.findFirst({ where: { id: request.params.jobId, userId }, select: { status: true } });
    if (!job) return reply.code(404).send({ error: 'Audiobook render job not found.' });
    return reply.code(409).send({ error: 'This render job can no longer be cancelled.', status: job.status });
  });

  fastify.get<{ Params: { jobId: string } }>('/api/v1/audiobook-jobs/:jobId/downloads', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const job = await fastify.prisma.audiobookRenderJob.findFirst({ where: { id: request.params.jobId, userId } });
    if (!job) return reply.code(404).send({ error: 'Audiobook render job not found.' });
    if (job.status !== 'completed' || !job.result || typeof job.result !== 'object') return reply.code(409).send({ error: 'Audiobook artifacts are not ready.' });
    const artifacts = (job.result as { artifacts?: Array<{ chapterId: string; chapterTitle: string; path: string }> }).artifacts;
    if (!Array.isArray(artifacts) || !artifacts.length || artifacts.some(item => !item || typeof item.chapterId !== 'string' || typeof item.path !== 'string' || !item.path.startsWith(`${userId}/`))) return reply.code(409).send({ error: 'Audiobook artifacts are unavailable.' });
    const storage = getStorage();
    if (!storage) return reply.code(503).send({ error: 'Private audiobook storage is not configured.' });
    const downloads = [];
    for (const artifact of artifacts) {
      const { data, error } = await storage.storage.from(BUCKET).createSignedUrl(artifact.path, 300);
      if (error || !data?.signedUrl) {
        fastify.log.error({ errorName: error?.name ?? 'unknown' }, 'Unable to create audiobook download link');
        return reply.code(502).send({ error: 'Could not prepare a secure audiobook download.' });
      }
      downloads.push({ chapterId: artifact.chapterId, chapterTitle: artifact.chapterTitle, url: data.signedUrl, expiresInSeconds: 300 });
    }
    return { downloads };
  });
};
