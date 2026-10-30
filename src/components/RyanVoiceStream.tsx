import React, { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

interface RyanVoiceStreamProps {
  language: string;
}

interface VoiceTicketResponse {
  ticket?: string;
  error?: string;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  error?: { message?: string };
}

const REALTIME_SAMPLE_RATE = 24_000;

function encodePcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function resampleTo24k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === REALTIME_SAMPLE_RATE) return samples;
  const outputLength = Math.floor(samples.length * REALTIME_SAMPLE_RATE / sourceRate);
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / REALTIME_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = sourcePosition - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function decodePcm16(encoded: string): Float32Array {
  const binary = atob(encoded);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    view.setUint8(index, binary.charCodeAt(index));
  }
  const samples = new Float32Array(Math.floor(binary.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

export const RyanVoiceStream = ({ language }: RyanVoiceStreamProps) => {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState('');
  const audioContext = useRef<AudioContext | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const mediaSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const playbackTime = useRef(0);
  const attemptId = useRef(0);
  const playbackNodes = useRef<Set<AudioBufferSourceNode>>(new Set());

  const releaseResources = useCallback(() => {
    attemptId.current += 1;
    if (processor.current) {
      processor.current.onaudioprocess = null;
      processor.current.disconnect();
      processor.current = null;
    }
    mediaSource.current?.disconnect();
    mediaSource.current = null;
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
    playbackNodes.current.forEach((node) => {
      try { node.stop(); } catch { /* The node may already have finished. */ }
      node.disconnect();
    });
    playbackNodes.current.clear();
    if (socket.current) {
      socket.current.onopen = null;
      socket.current.onmessage = null;
      socket.current.onerror = null;
      socket.current.onclose = null;
      socket.current.close();
      socket.current = null;
    }
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== 'closed') void context.close();
    playbackTime.current = 0;
  }, []);

  const stop = useCallback(() => {
    releaseResources();
    setStatus('idle');
  }, [releaseResources]);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    const attempt = ++attemptId.current;
    let pendingContext: AudioContext | null = null;
    setStatus('connecting');
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not available in this browser.');
      }
      const context = new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE });
      pendingContext = context;
      audioContext.current = context;
      await context.resume();
      if (attemptId.current !== attempt) {
        await context.close();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (attemptId.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        if (context.state !== 'closed') await context.close();
        return;
      }
      mediaStream.current = stream;

      const ticketResponse = await authenticatedFetch('/api/v1/realtime/voice-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      const ticketBody = await ticketResponse.json() as VoiceTicketResponse;
      if (attemptId.current !== attempt) return;
      if (!ticketResponse.ok || !ticketBody.ticket) {
        throw new Error(ticketBody.error || 'Could not authorize the realtime voice session.');
      }

      const endpoint = new URL('/api/v1/realtime/voice', API_BASE_URL);
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      endpoint.searchParams.set('ticket', ticketBody.ticket);
      if (attemptId.current !== attempt) return;
      const ws = new WebSocket(endpoint.toString());
      socket.current = ws;

      ws.onmessage = (message) => {
        if (typeof message.data !== 'string') return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.data) as RealtimeEvent;
        } catch {
          setError('RyanAI returned an unreadable voice event.');
          return;
        }
        if (event.type === 'session.started') {
          const activeContext = audioContext.current;
          const activeStream = mediaStream.current;
          if (!activeContext || !activeStream) {
            stop();
            return;
          }
          const source = activeContext.createMediaStreamSource(activeStream);
          const node = activeContext.createScriptProcessor(1024, 1, 1);
          const silentOutput = activeContext.createGain();
          silentOutput.gain.value = 0;
          source.connect(node);
          node.connect(silentOutput);
          silentOutput.connect(activeContext.destination);
          node.onaudioprocess = (audioEvent) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const input = audioEvent.inputBuffer.getChannelData(0);
            const audio = encodePcm16(resampleTo24k(input, activeContext.sampleRate));
            ws.send(JSON.stringify({ type: 'session.input_audio.append', audio }));
          };
          mediaSource.current = source;
          processor.current = node;
          setStatus('listening');
          return;
        }
        if (event.type === 'session.closed') {
          stop();
          return;
        }
        if (event.type === 'error') {
          setError(event.error?.message || 'The realtime voice service returned an error.');
          stop();
          setStatus('error');
          return;
        }
        if (event.type !== 'session.output_audio.delta' || !event.delta) return;
        const activeContext = audioContext.current;
        if (!activeContext) return;
        try {
          const samples = decodePcm16(event.delta);
          if (samples.length === 0) return;
          const buffer = activeContext.createBuffer(1, samples.length, REALTIME_SAMPLE_RATE);
          // Web Audio's copyToChannel requires an ArrayBuffer-backed Float32Array.
          // decodePcm16 may return an ArrayBufferLike view under newer TS libs.
          const playbackSamples = new Float32Array(samples.length);
          playbackSamples.set(samples);
          buffer.copyToChannel(playbackSamples, 0);
          const source = activeContext.createBufferSource();
          source.buffer = buffer;
          source.connect(activeContext.destination);
          const startAt = Math.max(activeContext.currentTime, playbackTime.current);
          source.start(startAt);
          playbackTime.current = startAt + buffer.duration;
          playbackNodes.current.add(source);
          source.onended = () => {
            playbackNodes.current.delete(source);
            source.disconnect();
          };
        } catch {
          setError('RyanAI returned audio that could not be decoded.');
        }
      };

      ws.onerror = () => {
        setError('The realtime voice connection failed.');
        stop();
        setStatus('error');
      };
      ws.onclose = () => {
        if (socket.current === ws) stop();
      };
    } catch (cause) {
      if (attemptId.current !== attempt) {
        if (pendingContext && pendingContext.state !== 'closed' && audioContext.current !== pendingContext) {
          await pendingContext.close();
        }
        return;
      }
      stop();
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not start realtime voice.');
    }
  }, [language, stop]);

  const previousLanguage = useRef(language);
  useEffect(() => {
    if (previousLanguage.current === language) return;
    previousLanguage.current = language;
    if (status === 'listening' || status === 'connecting') {
      releaseResources();
      void start();
    }
  }, [language, status, start, releaseResources]);

  const toggleVoiceLink = () => {
    if (status === 'connecting' || status === 'listening') {
      stop();
      return;
    }
    void start();
  };

  return (
    <div className="absolute top-4 right-4 z-30 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-cyan-500/60 bg-black/85 p-3 shadow-[0_0_15px_#0ff]">
      <span className={`h-3 w-3 shrink-0 rounded-full ${
        status === 'listening' ? 'bg-green-500 animate-pulse' :
        status === 'connecting' ? 'bg-amber-400 animate-pulse' :
        status === 'error' ? 'bg-rose-500' : 'bg-slate-500'
      }`} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={toggleVoiceLink}
          className="text-left font-mono text-xs uppercase tracking-wider text-cyan-300 hover:text-white"
        >
          {status === 'listening' ? 'Terminate live voice' :
            status === 'connecting' ? 'Cancel voice connection' :
            status === 'error' ? 'Retry live voice' : 'Initialize live voice'}
        </button>
        {error && <p role="status" className="mt-1 max-w-56 text-[10px] text-rose-300">{error}</p>}
      </div>
    </div>
  );
};
