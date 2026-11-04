import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from './auth.js';

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 4_000;
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
]);

interface AudioBody {
  audioBase64?: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
}
interface SpeechBody {
  text?: string;
  voice?: string;
  style?: string;
  speed?: number;
}

const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);

function decodeAudio(body: AudioBody): { bytes: Buffer; mimeType: string; fileName: string } | null {
  if (typeof body.audioBase64 !== 'string' || body.audioBase64.length === 0) return null;
  if (body.audioBase64.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8) return null;
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  if (!AUDIO_TYPES.has(mimeType)) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.audioBase64)) return null;
  const bytes = Buffer.from(body.audioBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || bytes.toString('base64') !== body.audioBase64) return null;
  const extension = mimeType.includes('mpeg') || mimeType === 'audio/mp3' ? 'mp3'
    : mimeType.includes('wav') ? 'wav'
      : mimeType.includes('ogg') ? 'ogg'
        : mimeType.includes('webm') ? 'webm'
          : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'bin';
  const hasPrefix = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const signatureValid = extension === 'mp3'
    ? hasPrefix(0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    : extension === 'wav'
      ? hasPrefix(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
      : extension === 'ogg'
        ? hasPrefix(0x4f, 0x67, 0x67, 0x53)
        : extension === 'webm'
          ? hasPrefix(0x1a, 0x45, 0xdf, 0xa3)
          : bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!signatureValid) return null;
  return { bytes, mimeType, fileName: \`audio.\${extension}\` };
}

export const audioIntelligenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: AudioBody }>('/api/v1/audio/transcriptions', {
    bodyLimit: 23 * 1024 * 1024,
    preHandler: requireUser,
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return reply.code(503).send({ error: 'Audio transcription is not configured on this server.' });
    const audio = decodeAudio(request.body ?? {});
    if (!audio) return reply.code(400).send({ error: 'Provide a supported audio file (maximum 16 MB) as valid base64.' });

    const form = new FormData();
    form.append('file', new Blob([audio.bytes], { type: audio.mimeType }), audio.fileName);
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('response_format', 'json');

    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        fastify.log.warn({ statusCode: response.status }, 'Audio transcription provider request failed');
        return reply.code(response.status === 429 ? 429 : 502).send({
          error: response.status === 429
            ? 'Audio transcription is temporarily rate limited. Please retry later.'
            : 'Audio transcription provider could not process this recording.',
        });
      }
      const result = await response.json() as { text?: unknown };
      if (typeof result.text !== 'string' || !result.text.trim()) {
        return reply.code(502).send({ error: 'The transcription provider returned no transcript.' });
      }
      return reply.send({ text: result.text, model: 'gpt-4o-mini-transcribe', status: 'completed' });
    } catch (error) {
      fastify.log.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Audio transcription request failed');
      return reply.code(502).send({ error: 'Audio transcription could not be completed. Please retry.' });
    }
  });

  fastify.post<{ Body: SpeechBody }>('/api/v1/audio/speech', {
    preHandler: requireUser,
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return reply.code(503).send({ error: 'Audiobook speech generation is not configured on this server.' });
    const body = request.body ?? {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const voice = typeof body.voice === 'string' ? body.voice : 'coral';
    const style = typeof body.style === 'string' ? body.style.trim() : '';
    const speed = typeof body.speed === 'number' ? body.speed : 1;
    if (!text || text.length > MAX_TRANSCRIPT_CHARS) {
      return reply.code(400).send({ error: 'Narration text must contain 1–4,000 characters per render.' });
    }
    if (!VOICES.has(voice)) return reply.code(400).send({ error: 'Select a supported narration voice.' });
    if (!Number.isFinite(speed) || speed < 0.8 || speed > 1.2) {
      return reply.code(400).send({ error: 'Narration speed must be between 0.8 and 1.2.' });
    }
    if (style.length > 500) return reply.code(400).send({ error: 'Narration direction must be 500 characters or fewer.' });

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice,
          input: text,
          instructions: style || 'Speak naturally and clearly, with expressive audiobook narration and appropriate pauses.',
          response_format: 'mp3',
          speed,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        fastify.log.warn({ statusCode: response.status }, 'Audiobook speech provider request failed');
        return reply.code(response.status === 429 ? 429 : 502).send({
          error: response.status === 429
            ? 'Speech generation is temporarily rate limited. Please retry later.'
            : 'Speech generation provider could not render this chapter segment.',
        });
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 24 * 1024 * 1024) {
        return reply.code(502).send({ error: 'The speech provider returned an invalid audio artifact.' });
      }
      return reply.send({ audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg', model: 'gpt-4o-mini-tts', status: 'completed' });
    } catch (error) {
      fastify.log.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Audiobook speech generation failed');
      return reply.code(502).send({ error: 'Speech generation could not be completed. Please retry.' });
    }
  });
};
