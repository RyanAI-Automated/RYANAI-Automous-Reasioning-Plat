import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createLoginGreeting } from '@/shared/ryanIdentity';
import { DEFAULT_RYANAI_LANGUAGE, getLanguageLabel, OWNER_VENDA_LANGUAGE, RYANAI_LANGUAGES, isSupportedRyanLanguage } from '@/shared/languages';

interface GreetingProps {
  userId: string;
  displayName?: string | null;
  isOwner?: boolean;
  preferredTitle?: string | null;
  preferredLanguage?: string | null;
  preferredVoiceLanguage?: string | null;
}

const TITLES = ['Sir G', 'Sir', 'Use my name', 'Mr', 'Ms', 'Mx', 'Dr'];

export default function Greeting({
  userId,
  displayName,
  isOwner = false,
  preferredTitle,
  preferredLanguage,
  preferredVoiceLanguage,
}: GreetingProps) {
  const [title, setTitle] = useState(preferredTitle || (isOwner ? 'Sir G' : ''));
  const [language, setLanguage] = useState(
    isSupportedRyanLanguage(preferredLanguage || '') ? preferredLanguage! : DEFAULT_RYANAI_LANGUAGE,
  );
  const [voiceLanguage, setVoiceLanguage] = useState(
    isSupportedRyanLanguage(preferredVoiceLanguage || '')
      ? preferredVoiceLanguage!
      : isOwner ? OWNER_VENDA_LANGUAGE : DEFAULT_RYANAI_LANGUAGE,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const spoken = useRef(false);
  const firstName = displayName?.trim().split(/\s+/)[0] || 'there';
  const address = isOwner ? (title || 'Sir G') : (title && title !== 'Use my name' ? title : firstName);
  const greeting = createLoginGreeting({
    displayName: address,
    isOwner: false,
  });
  const matchingVoices = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase() === voiceLanguage.toLowerCase()),
    [voices, voiceLanguage],
  );
  const voiceSupported = matchingVoices.length > 0;

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const savePreferences = useCallback(async (next: {
    preferred_title: string;
    preferred_language: string;
    preferred_voice_language: string;
  }) => {
    if (!supabase) {
      setStatus('Account settings are unavailable until authentication is configured.');
      return;
    }
    setSaving(true);
    setStatus('');
    const { error } = await supabase.auth.updateUser({ data: next });
    setSaving(false);
    setStatus(error ? 'Could not save preferences. Please try again.' : 'Your preferences are saved to your account.');
  }, []);

  const speak = useCallback(() => {
    if (!voiceEnabled) {
      setStatus('Voice greetings are switched off.');
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setStatus('This device does not support browser speech.');
      return;
    }
    const available = window.speechSynthesis.getVoices();
    const selected = available.find((voice) => voice.lang.toLowerCase() === voiceLanguage.toLowerCase());
    if (!selected) {
      setStatus(`No installed ${getLanguageLabel(voiceLanguage)} voice is available on this device. Text preferences are still saved.`);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(greeting);
    utterance.lang = voiceLanguage;
    utterance.voice = selected;
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    utterance.onstart = () => setStatus(`Speaking with ${selected.name}.`);
    utterance.onerror = () => setStatus('The selected device voice could not speak this greeting.');
    window.speechSynthesis.speak(utterance);
  }, [greeting, voiceEnabled, voiceLanguage]);

  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    speak();
  }, [speak]);

  const update = (nextTitle: string, nextLanguage: string, nextVoiceLanguage: string) => {
    setTitle(nextTitle);
    setLanguage(nextLanguage);
    setVoiceLanguage(nextVoiceLanguage);
    void savePreferences({
      preferred_title: nextTitle,
      preferred_language: nextLanguage,
      preferred_voice_language: nextVoiceLanguage,
    });
  };

  return (
    <section className="mx-4 mt-4 rounded-xl border border-cyan-400/20 bg-slate-900/70 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-cyan-200">{greeting}</h2>
          <p className="mt-1 text-xs text-slate-400">RyanAI language and voice preferences · Account: {displayName || userId}</p>
        </div>
        <button type="button" onClick={speak} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/10">
          <Volume2 className="mr-1 inline h-4 w-4" /> Hear greeting
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-300">
          How RyanAI addresses you
          <select value={title || 'Use my name'} disabled={saving} onChange={(event) => update(event.target.value === 'Use my name' ? '' : event.target.value, language, voiceLanguage)} className="mt-1 w-full rounded-lg border border-cyan-400/20 bg-slate-950 px-3 py-2 text-sm text-white">
            {(isOwner ? TITLES : ['Use my name', 'Mr', 'Ms', 'Mx', 'Dr']).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-300">
          Reply and translation language
          <select value={language} disabled={saving} onChange={(event) => update(title, event.target.value, voiceLanguage)} className="mt-1 w-full rounded-lg border border-cyan-400/20 bg-slate-950 px-3 py-2 text-sm text-white">
            <optgroup label="South African languages">{RYANAI_LANGUAGES.filter((item) => item.group === 'South African languages').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</optgroup>
            <optgroup label="International English">{RYANAI_LANGUAGES.filter((item) => item.group === 'International English').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</optgroup>
          </select>
        </label>
        <label className="text-xs text-slate-300">
          Spoken voice language
          <select value={voiceLanguage} disabled={saving} onChange={(event) => update(title, language, event.target.value)} className="mt-1 w-full rounded-lg border border-cyan-400/20 bg-slate-950 px-3 py-2 text-sm text-white">
            <optgroup label="South African languages">{RYANAI_LANGUAGES.filter((item) => item.group === 'South African languages').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</optgroup>
            <optgroup label="International English">{RYANAI_LANGUAGES.filter((item) => item.group === 'International English').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</optgroup>
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setVoiceEnabled((enabled) => !enabled)} className="rounded-lg border border-cyan-400/20 px-3 py-2 text-cyan-200">
          {voiceEnabled ? <><VolumeX className="mr-1 inline h-4 w-4" /> Turn voice off</> : <><Volume2 className="mr-1 inline h-4 w-4" /> Turn voice on</>}
        </button>
        <span className={voiceSupported ? 'text-emerald-300' : 'text-amber-300'}>
          {voiceSupported ? `Device voice available: ${matchingVoices[0].name}` : `No installed voice detected for ${getLanguageLabel(voiceLanguage)}`}
        </span>
        {saving && <span className="text-slate-400">Saving…</span>}
        {status && <span role="status" className="text-slate-300">{status}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Language selection guides RyanAI's written replies and translation. Voice availability depends on your device or configured speech provider; the app will not pretend an unavailable voice is active.</p>
    </section>
  );
}
