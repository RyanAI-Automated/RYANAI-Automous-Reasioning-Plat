import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTimeGreeting } from '@/shared/ryanIdentity';
import {
  DEFAULT_LANGUAGE,
  OWNER_DEFAULT_LANGUAGE,
  RYANAI_LANGUAGES,
  getLanguageName,
} from '@/shared/languages';

interface GreetingProps {
  userId?: string;
  displayName?: string | null;
  isOwner?: boolean;
}

const languageKey = (userId: string) => `ryanai:language:${userId}`;

export function getStoredRyanLanguage(userId: string, isOwner: boolean): string {
  try {
    const stored = window.localStorage.getItem(languageKey(userId));
    if (stored && RYANAI_LANGUAGES.some((language) => language.code === stored)) return stored;
  } catch { /* browser storage may be disabled */ }
  return isOwner ? OWNER_DEFAULT_LANGUAGE : DEFAULT_LANGUAGE;
}

export default function Greeting({ userId: accountId, displayName, isOwner = false }: GreetingProps) {
  const userId = accountId || displayName || 'guest';
  const [language, setLanguage] = useState(() => getStoredRyanLanguage(userId, isOwner));
  const [title, setTitle] = useState(() => {
    try {
      return window.localStorage.getItem(`ryanai:title:${userId}`) ?? (isOwner ? 'Sir G' : '');
    } catch { return isOwner ? 'Sir G' : ''; }
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState('Voice settings ready');
  const [voiceUri, setVoiceUri] = useState(() => {
    try { return window.localStorage.getItem('ryanai:voice-uri') ?? ''; } catch { return ''; }
  });
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return window.localStorage.getItem('ryanai:voice-enabled') !== 'false'; } catch { return true; }
  });
  const spoken = useRef(false);
  const firstName = displayName?.trim().split(/\s+/)[0] || 'there';
  const address = title || firstName;
  const greeting = `${getTimeGreeting()}, ${address}. I'm RyanAI. Your assistant is ready.`;
  const matchingVoices = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase() === language.toLowerCase()),
    [language, voices],
  );

  const speak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceStatus('Speech playback is not supported by this device.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(greeting);
    utterance.lang = language;
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    const selected = matchingVoices.find((voice) => voice.voiceURI === voiceUri) ?? matchingVoices[0];
    if (selected) utterance.voice = selected;
    utterance.onstart = () => setVoiceStatus(`Speaking · ${selected?.name ?? 'device default'} · ${getLanguageName(language)}`);
    utterance.onend = () => setVoiceStatus(`Ready · ${getLanguageName(language)}`);
    utterance.onerror = () => setVoiceStatus('Tap Play greeting to allow playback, or choose an installed voice.');
    window.speechSynthesis.speak(utterance);
    if (!selected) setVoiceStatus(`No installed ${getLanguageName(language)} voice detected; device fallback may be used.`);
  }, [greeting, language, matchingVoices, voiceUri]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    spoken.current = false;
  }, [userId]);

  useEffect(() => {
    if (voiceEnabled && voices.length && !spoken.current) {
      spoken.current = true;
      speak();
    }
  }, [voiceEnabled, voices.length, speak]);

  const chooseLanguage = (code: string) => {
    setLanguage(code);
    try {
      window.localStorage.setItem(languageKey(userId), code);
      window.localStorage.setItem('ryanai:language', code);
    } catch { /* browser storage may be disabled */ }
    window.dispatchEvent(new CustomEvent('ryanai:language-changed', { detail: { language: code } }));
  };

  const chooseVoice = (value: string) => {
    setVoiceUri(value);
    try { window.localStorage.setItem('ryanai:voice-uri', value); } catch { /* browser storage may be disabled */ }
  };

  const chooseTitle = (value: string) => {
    setTitle(value);
    try { window.localStorage.setItem(`ryanai:title:${userId}`, value); } catch { /* browser storage may be disabled */ }
  };

  const toggleVoice = () => {
    const enabled = !voiceEnabled;
    setVoiceEnabled(enabled);
    try { window.localStorage.setItem('ryanai:voice-enabled', String(enabled)); } catch { /* browser storage may be disabled */ }
    if (enabled) speak();
    else window.speechSynthesis?.cancel();
  };

  return (
    <section className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 px-4 py-3" aria-live="polite">
      <div className="min-w-[220px]">
        <h2 className="text-lg font-semibold text-cyan-200">{greeting}</h2>
        <p className="mt-1 text-xs text-slate-400">RyanAI · {isOwner ? 'Sir G — Ntsiyeni Ganyane' : displayName || 'Personal assistant'} · {getLanguageName(language)}</p>
        <p className="mt-1 text-xs text-slate-400" role="status">{voiceStatus}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ryanai-title">Preferred form of address</label>
        <select id="ryanai-title" value={title} onChange={(event) => chooseTitle(event.target.value)} className="max-w-44 rounded-lg border border-cyan-400/30 bg-slate-950 px-2 py-2 text-xs text-cyan-100">
          <option value="">Use my name</option>
          <option value="Sir">Sir</option>
          <option value="Sir G">Sir G</option>
          {isOwner && <option value="Ntsiyeni Ganyane">Ntsiyeni Ganyane</option>}
        </select>
        <label className="sr-only" htmlFor="ryanai-language">RyanAI language and translation preference</label>
        <select id="ryanai-language" value={language} onChange={(event) => chooseLanguage(event.target.value)} className="max-w-56 rounded-lg border border-cyan-400/30 bg-slate-950 px-2 py-2 text-xs text-cyan-100">
          <optgroup label="South African official languages">
            {RYANAI_LANGUAGES.filter((item) => item.region === 'South Africa').map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </optgroup>
          <optgroup label="International languages">
            {RYANAI_LANGUAGES.filter((item) => item.region === 'International').map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </optgroup>
        </select>
        <label className="sr-only" htmlFor="ryanai-voice">Available device voice</label>
        <select id="ryanai-voice" value={voiceUri} onChange={(event) => chooseVoice(event.target.value)} className="max-w-48 rounded-lg border border-cyan-400/30 bg-slate-950 px-2 py-2 text-xs text-cyan-100">
          <option value="">Automatic matching voice</option>
          {matchingVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
        </select>
        <button type="button" onClick={speak} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/10">Play greeting</button>
        <button type="button" onClick={toggleVoice} aria-pressed={voiceEnabled} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/10">{voiceEnabled ? 'Voice on' : 'Voice off'}</button>
      </div>
    </section>
  );
}
