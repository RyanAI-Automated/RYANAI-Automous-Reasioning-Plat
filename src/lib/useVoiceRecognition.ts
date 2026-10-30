// src/lib/useVoiceRecognition.ts
// Browser speech recognition with graceful feature detection and cleanup.

import { useCallback, useEffect, useRef, useState } from 'react';

export const VOICE_COMMANDS = {
  new_thread: { keywords: ['new', 'start'], action: 'Create new conversation' },
  switch_gemini: { keywords: ['gemini'], action: 'Switch to Gemini' },
  switch_claude: { keywords: ['claude'], action: 'Switch to Claude' },
  switch_gpt: { keywords: ['gpt'], action: 'Switch to GPT' },
  export: { keywords: ['export'], action: 'Export conversation' },
  open_memory: { keywords: ['open memory', 'memory'], action: 'Open memory vault' },
  open_about: { keywords: ['about'], action: 'Show about' },
  open_github: { keywords: ['github'], action: 'Open GitHub' },
  stop: { keywords: ['stop'], action: 'Stop listening' },
} as const;

export interface UseVoiceRecognitionOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onCommand?: (command: string, args: string) => void;
  /** BCP-47 speech recognition language. Defaults to South African English. */
  language?: string;
}

type VoiceState = 'idle' | 'listening';

function getSpeechRecognitionConstructor(): SpeechRecognitionStatic | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/** Starts and manages the browser's native speech recognizer when supported. */
export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}) {
  const { onTranscript, onCommand, language = 'en-ZA' } = options;
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [interimText, setInterimText] = useState('');
  const isSupported = typeof window !== 'undefined' && Boolean(getSpeechRecognitionConstructor());

  const stop = useCallback(() => {
    listeningRef.current = false;
    setState('idle');
    setInterimText('');
    const recognizer = recognitionRef.current;
    recognitionRef.current = null;
    if (recognizer) {
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      try {
        recognizer.stop();
      } catch {
        // A recognizer may already have stopped; cleanup remains complete.
      }
    }
  }, []);

  const toggle = useCallback(() => {
    if (listeningRef.current) {
      stop();
      return;
    }

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) return;

    const recognizer = new SpeechRecognitionConstructor();
    recognitionRef.current = recognizer;
    recognizer.lang = language;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = () => {
      listeningRef.current = true;
      setState('listening');
    };

    recognizer.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          setInterimText('');
          onTranscript?.(transcript, true);
          const normalized = transcript.toLocaleLowerCase();
          const command = Object.entries(VOICE_COMMANDS).find(([, definition]) =>
            definition.keywords.some((keyword) => normalized === keyword || normalized.startsWith(`${keyword} `)),
          );
          if (command) {
            const [name, definition] = command;
            const keyword = definition.keywords.find((item) =>
              normalized === item || normalized.startsWith(`${item} `),
            ) ?? '';
            onCommand?.(name, transcript.slice(keyword.length).trim());
            if (name === 'stop') {
              stop();
              return;
            }
          }
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
    };

    recognizer.onerror = () => {
      listeningRef.current = false;
      setState('idle');
      setInterimText('');
      if (recognitionRef.current === recognizer) recognitionRef.current = null;
    };

    recognizer.onend = () => {
      if (recognitionRef.current === recognizer) {
        recognitionRef.current = null;
        listeningRef.current = false;
        setState('idle');
        setInterimText('');
      }
    };

    try {
      recognizer.start();
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setState('idle');
    }
  }, [language, onCommand, onTranscript, stop]);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = language;
  }, [language]);

  useEffect(() => stop, [stop]);

  return {
    isSupported,
    isListening: state === 'listening',
    state,
    interimText,
    toggle,
    stop,
  };
}
