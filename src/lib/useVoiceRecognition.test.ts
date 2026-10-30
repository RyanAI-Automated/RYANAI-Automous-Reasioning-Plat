/** @vitest-environment happy-dom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecognition } from './useVoiceRecognition.js';

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | undefined;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() { MockSpeechRecognition.latest = this; }
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

type HookResult = ReturnType<typeof useVoiceRecognition>;
type HookHarness = (() => HookResult) & {
  rerender: (options: Parameters<typeof useVoiceRecognition>[0]) => void;
};

function mountHook(options: Parameters<typeof useVoiceRecognition>[0] = {}) {
  let result: HookResult | undefined;
  let currentOptions = options;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  function Harness() {
    result = useVoiceRecognition(currentOptions);
    return null;
  }
  act(() => root?.render(React.createElement(Harness)));
  const getResult = (() => result!) as HookHarness;
  getResult.rerender = (nextOptions) => {
    currentOptions = nextOptions;
    act(() => root?.render(React.createElement(Harness)));
  };
  return getResult;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  MockSpeechRecognition.latest = undefined;
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
    expect(MockSpeechRecognition.latest?.lang).toBe('ve-ZA');
    expect(MockSpeechRecognition.latest?.continuous).toBe(true);
    expect(MockSpeechRecognition.latest?.interimResults).toBe(true);

    act(() => MockSpeechRecognition.latest?.emit('Ndi khou ṱoḓa thuso', false));
    expect(getResult().interimText).toBe('Ndi khou ṱoḓa thuso');
    expect(onTranscript).not.toHaveBeenCalled();

    act(() => MockSpeechRecognition.latest?.emit('Ndi khou ṱoḓa thuso', true));
    expect(onTranscript).toHaveBeenCalledWith('Ndi khou ṱoḓa thuso', true);
    expect(getResult().interimText).toBe('');
  });

  it('dispatches recognized voice commands and stops on the stop command', () => {
    window.SpeechRecognition = MockSpeechRecognition as unknown as SpeechRecognitionStatic;
    const onCommand = vi.fn();
    const getResult = mountHook({ onCommand });

    act(() => getResult().toggle());
    act(() => MockSpeechRecognition.latest?.emit('open memory', true));
    expect(onCommand).toHaveBeenCalledWith('open_memory', '');

    act(() => MockSpeechRecognition.latest?.emit('stop listening', true));
    expect(onCommand).toHaveBeenCalledWith('stop', 'listening');
    expect(getResult().state).toBe('idle');
  });

  it('updates the active recognizer when the selected language changes', () => {
    window.SpeechRecognition = MockSpeechRecognition as unknown as SpeechRecognitionStatic;
    const getResult = mountHook({ language: 'en-ZA' });

    act(() => getResult().toggle());
    expect(MockSpeechRecognition.latest?.lang).toBe('en-ZA');

    getResult.rerender({ language: 've-ZA' });
    expect(MockSpeechRecognition.latest?.lang).toBe('ve-ZA');
  });

  it('cleans up safely when speech recognition is unavailable', () => {
    const getResult = mountHook();
    expect(getResult().isSupported).toBe(false);
    act(() => getResult().toggle());
    expect(getResult().state).toBe('idle');
  });
});
