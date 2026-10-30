import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RYANAI_LANGUAGE,
  findSpeechVoice,
  getGreetingLanguageText,
  getRyanLanguage,
  RYANAI_LANGUAGES,
} from '@/shared/ryanLocales';

interface GreetingProps {
  userId: string;
  displayName?: string | null;
  isOwner?: boolean;
}

const LANGUAGE_KEY = 'ryanai:preferred-language:';

export default function Greeting({ userId, displayName, isOwner = false }: GreetingProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState('Voice availability is being checked');
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem(`${LANGUAGE_KEY}${userId}`) ?? (isOwner ? 've-ZA' : DEFAULT_RYANAI_LANGUAGE);
    } catch {
      return isOwner ? 've-ZA' : DEFAULT_RYANAI_LANGUAGE;
    }
  });
  const [address, setAddress] = useState(() => {
    try {
      return localStorage.getItem(`ryanai:preferred-address:${userId}`) ?? (isOwner ? 'Sir G' : '');
    } catch {
      return isOwner ? 'Sir G' : '';
    }
  });
  const spoken = useRef(false);
  const selectedLanguage = getRyanLanguage(language);
  const selectedVoice = useMemo(() => findSpeechVoice(voices, selectedLanguage.speechLocale), [voices, selectedLanguage]);
  const hour = new Date().getHours();
  const greetingText = getGreetingLanguageText(language, hour);
  const greeting = `${greetingText}, ${address || displayName?.trim().split(/\\s+/)[0] || 'there'}.`;

  const speak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoiceStatus('Speech is not supported by this browser.');
      return;
    }
    if (!selectedVoice) {
      setVoiceStatus(`Text language selected: ${selectedLanguage.label}. No matching device voice is installed; RyanAI will not substitute a different accent.`);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(greeting);
    utterance.lang = selectedLanguage.speechLocale;
    utterance.voice = selectedVoice;
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    utterance.onstart = () => setVoiceStatus(`Speaking ${selectedLanguage.label} · ${selectedVoice.name}`);
    utterance.onend = () => setVoiceStatus(`Ready · ${selectedLanguage.label}`);
    utterance.onerror = () => setVoiceStatus(`Voice playback failed for ${selectedLanguage.label}.`);
    window.speechSynthesis.speak(utterance);
  }, [greeting, selectedLanguage, selectedVoice]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refreshVoices = () => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (spoken.current || !selectedVoice) return;
    spoken.current = true;
    speak();
  }, [speak, selectedVoice]);

  useEffect(() => {
    document.documentElement.lang = selectedLanguage.speechLocale;
    try { localStorage.setItem(`${LANGUAGE_KEY}${userId}`, language); } catch { /* storage may be disabled */ }
  }, [language, selectedLanguage.speechLocale, userId]);

  useEffect(() => {
    try { localStorage.setItem(`ryanai:preferred-address:${userId}`, address); } catch { /* storage may be disabled */ }
  }, [address, userId]);

  return (
    <section className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 px-4 py-3" aria-live="polite">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-cyan-200">{greeting}</h2>
        <p className="mt-1 text-xs text-slate-400">RyanAI language and voice profile · {selectedLanguage.label} · {selectedLanguage.speechLocale}</p>
        <p className="mt-1 text-xs text-slate-400" role="status">{voiceStatus}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ryanai-address-choice">How RyanAI addresses you</label>
        <select id="ryanai-address-choice" value={address} onChange={(event) => setAddress(event.target.value)} className="rounded-lg border border-white/15 bg-slate-950 px-2 py-2 text-xs text-slate-200">
          <option value="">Use my name</option>
          {isOwner && <option value="Sir G">Sir G</option>}
          <option value="Sir">Sir</option>
          <option value="Ntsiyeni Ganyane">Ntsiyeni Ganyane</option>
          {displayName && <option value={displayName}>{displayName}</option>}
        </select>
        <label className="sr-only" htmlFor="ryanai-language-choice">RyanAI language and voice</label>
        <select id="ryanai-language-choice" value={language} onChange={(event) => { setLanguage(event.target.value); spoken.current = false; }} className="max-w-64 rounded-lg border border-white/15 bg-slate-950 px-2 py-2 text-xs text-slate-200">
          <optgroup label="South African languages">
            {RYANAI_LANGUAGES.filter((item) => item.group === 'South African').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </optgroup>
          <optgroup label="International languages">
            {RYANAI_LANGUAGES.filter((item) => item.group === 'International').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </optgroup>
        </select>
        <button type="button" onClick={speak} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/10" aria-label="Hear RyanAI greeting in the selected language">
          Play voice greeting
        </button>
      </div>
    </section>
  );
}
