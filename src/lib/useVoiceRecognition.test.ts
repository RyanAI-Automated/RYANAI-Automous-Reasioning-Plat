/** @vitest-environment happy-dom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecognition } from './useVoiceRecognition.js';

let lastRecognizer: MockSpeechRecognition | undefined;

class MockSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() { lastRecognizer = this; }
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
  lastRecognizer = undefined;
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

describe('useVoiceRecognition', () => {
  it('starts recognition in the selected language and forwards interim and final transcripts', () => {
    window.SpeechRecognition = MockSpeechRecognition as unknown as SpeechRecognitionStatic;
    const onTranscript = vi.fn();
    const getResult = mountHook({ language: 've-ZA', onTranscript });

    act(() => getResult().toggle());

    expect(getResult().isSupported).toBe(true);
    expect(getResult().state).toBe('listening');
    expect(lastRecognizer?.lang).toBe('ve-ZA');
    expect(lastRecognizer?.continuous).toBe(true);
    expect(lastRecognizer?.interimResults).toBe(true);

    act(() => lastRecognizer?.emit('Ndi khou ṱoḓa thuso', false));
    expect(getResult().interimText).toBe('Ndi khou ṱoḓa thuso');
    expect(onTranscript).not.toHaveBeenCalled();

    act(() => lastRecognizer?.emit('Ndi khou ṱoḓa thuso', true));
    expect(onTranscript).toHaveBeenCalledWith('Ndi khou ṱoḓa thuso', true);
    expect(getResult().interimText).toBe('');
  });

  it('dispatches recognized voice commands and stops on the stop command', () => {
    window.SpeechRecognition = MockSpeechRecognition as unknown as SpeechRecognitionStatic;
    const onCommand = vi.fn();
    const getResult = mountHook({ onCommand });

    act(() => getResult().toggle());
    act(() => lastRecognizer?.emit('open memory', true));
    expect(onCommand).toHaveBeenCalledWith('open_memory', '');

    act(() => lastRecognizer?.emit('stop listening', true));
    expect(onCommand).toHaveBeenCalledWith('stop', 'listening');
    expect(getResult().state).toBe('idle');
  });

  it('cleans up safely when speech recognition is unavailable', () => {
    const getResult = mountHook();
    expect(getResult().isSupported).toBe(false);
    act(() => getResult().toggle());
    expect(getResult().state).toBe('idle');
  });
});
