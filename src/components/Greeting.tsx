import { useCallback, useEffect, useRef, useState } from 'react';
import { createLoginGreeting, RYANAI_LOCALE } from '@/shared/ryanIdentity';

interface GreetingProps {
  displayName?: string | null;
  isOwner?: boolean;
}

export default function Greeting({ displayName, isOwner = false }: GreetingProps) {
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const spoken = useRef(false);
  const greeting = createLoginGreeting({ displayName, isOwner });

  const speak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoiceAvailable(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(greeting);
    utterance.lang = RYANAI_LOCALE;
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const southAfricanVoice = voices.find((voice) => voice.lang.toLowerCase() === RYANAI_LOCALE.toLowerCase());
    if (southAfricanVoice) utterance.voice = southAfricanVoice;
    window.speechSynthesis.speak(utterance);
    setVoiceAvailable(true);
  }, [greeting]);

  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    speak();
    const refreshVoices = () => setVoiceAvailable('speechSynthesis' in window);
    window.speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', refreshVoices);
    };
  }, [speak]);

  return (
    <section className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 px-4 py-3" aria-live="polite">
      <div>
        <h2 className="text-lg font-semibold text-cyan-200">{greeting}</h2>
        <p className="mt-1 text-xs text-slate-400">RyanAI voice identity · English (South Africa) · {RYANAI_LOCALE}</p>
      </div>
      <button
        type="button"
        onClick={speak}
        className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/10"
        aria-label="Hear RyanAI greeting again"
      >
        {voiceAvailable ? 'Replay voice greeting' : 'Play voice greeting'}
      </button>
    </section>
  );
}
