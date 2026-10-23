// src/lib/useVoiceRecognition.ts
// Voice recognition hook

import { useEffect, useState, useCallback } from 'react';

export const VOICE_COMMANDS = {
  new_thread: { keywords: ['new', 'start'], action: 'Create new conversation' },
  switch_gemini: { keywords: ['gemini'], action: 'Switch to Gemini' },
  switch_claude: { keywords: ['claude'], action: 'Switch to Claude' },
  switch_gpt: { keywords: ['gpt'], action: 'Switch to GPT' },
  export: { keywords: ['export'], action: 'Export conversation' },
  open_memory: { keywords: ['memory'], action: 'Open memory vault' },
  open_about: { keywords: ['about'], action: 'Show about' },
  open_github: { keywords: ['github'], action: 'Open GitHub' },
  stop: { keywords: ['stop'], action: 'Stop listening' },
};

export interface UseVoiceRecognitionOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onCommand?: (command: string, args: string) => void;
}

/**
 * Expose browser speech-recognition availability and local listening controls.
 * The controls only update UI state; no recognizer is started and options callbacks
 * are currently unused.
 */
export function useVoiceRecognition(_options: UseVoiceRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    const supported =
      'webkitSpeechRecognition' in window ||
      'SpeechRecognition' in window;
    setIsSupported(supported);
  }, []);

  const toggle = useCallback(() => {
    if (!isSupported) return;

    setIsListening(!isListening);
    setInterimText('');
  }, [isListening, isSupported]);

  const stop = useCallback(() => {
    setIsListening(false);
    setInterimText('');
  }, []);

  return {
    isSupported,
    isListening,
    state: isListening ? 'listening' : 'idle',
    interimText,
    toggle,
    stop,
  };
}
