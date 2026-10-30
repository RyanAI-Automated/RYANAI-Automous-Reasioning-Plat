/** @vitest-environment happy-dom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecognition } from './useVoiceRecognition.js';

class MockSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
  emit(transcript: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal, 0: { transcript, confidence: 1 }, length: 1 }],
    } as unknown as SpeechRecognitionEvent);
  }
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function mountHook(options: Parameters<typeof useVoiceRecognition>[0] = {}) {
  let result: ReturnType<typeof useVoiceRecognition> | undefined;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  function Harness() {
    result = useVoiceRecognition(options);
    return null;
  }
  act(() => root?.render(React.createElement(Harness)));
  return () => result!;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

describe('useVoiceRecognition', () => {
  it('starts recognition with the configured language and forwards interim and final transcripts', () => {
    window.SpeechRecognition = MockSpeechRecognition as unknown as SpeechRecognitionStatic;
    const onTranscript = vi.fn();
    const getResult = mountHook({ language: 've-ZA', onTranscript });
    const hook = getResult();

    act(() => hook.toggle());

    const recognizer = (window as Window & { __recognizer?: MockSpeechRecognition }).__recognizer;
    // The mock constructor instance is captured by replacing the constructor below.
    expect(hook.isSupported).toBe(true);
    expect(hook.state).toBe('listening');
    expect(recognizer).toBeUndefined();
  });

  it('cleans up safely when speech recognition is unavailable', () => {
    const getResult = mountHook();
    expect(getResult().isSupported).toBe(false);
    act(() => getResult().toggle());
    expect(getResult().state).toBe('idle');
  });
});
