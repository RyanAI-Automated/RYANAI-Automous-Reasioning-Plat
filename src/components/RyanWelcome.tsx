import { useCallback, useEffect, useMemo, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const LANGUAGE = 'en-ZA';
const VOICE_ENABLED_KEY = 'ryanai:voice-greetings-enabled';
const VOICE_URI_KEY = 'ryanai:voice-greeting-uri';

interface RyanWelcomeProps {
  userId: string;
  displayName: string;
  preferredTitle?: string;
}

/**
 * Welcome the authenticated user once each time this authenticated view mounts.
 * Browser speech is best-effort: browsers may block autoplay until the user interacts.
 */
export default function RyanWelcome({
  userId,
  displayName,
  preferredTitle,
}: RyanWelcomeProps) {
  const firstName = displayName.trim().split(/\s+/)[0] || 'there';
  const address = preferredTitle?.trim() || firstName;
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greeting = `${timeGreeting}, ${address}. I am RyanAI. Welcome back. I am ready to assist you.`;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState(() => {
    try { return window.localStorage.getItem(VOICE_URI_KEY) ?? ''; } catch { return ''; }
  });
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return window.localStorage.getItem(VOICE_ENABLED_KEY) !== 'false'; } catch { return true; }
  });
  const [voiceStatus, setVoiceStatus] = useState('English (South Africa)');

  const availableVoices = useMemo(
    () => voices.filter((voice) => voice.lang.toLowerCase().startsWith('en-za')),
    [voices],
  );

  const speak = useCallback(() => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceStatus('Voice playback is not supported by this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(greeting);
    utterance.lang = LANGUAGE;
    const selected = voices.find((voice) => voice.voiceURI === voiceUri)
      ?? availableVoices[0]
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en-'));
    if (selected) utterance.voice = selected;
    utterance.onstart = () => setVoiceStatus(`Speaking · ${selected?.name ?? 'device voice'} · English (South Africa)`);
    utterance.onend = () => setVoiceStatus('Ready · English (South Africa)');
    utterance.onerror = () => setVoiceStatus('Tap Play greeting to allow voice playback.');
    window.speechSynthesis.speak(utterance);
  }, [availableVoices, greeting, voiceUri, voices]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    // Attempt the login greeting on every authenticated mount. If autoplay is blocked,
    // the visible Play button provides the browser-required user gesture.
    if (voiceEnabled && voices.length) speak();
  }, [userId, voiceEnabled, voices.length, speak]);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    try { window.localStorage.setItem(VOICE_ENABLED_KEY, String(next)); } catch { /* storage may be disabled */ }
    if (next) speak();
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const chooseVoice = (value: string) => {
    setVoiceUri(value);
    try { window.localStorage.setItem(VOICE_URI_KEY, value); } catch { /* storage may be disabled */ }
  };

  return (
    <section aria-label="RyanAI welcome" className="mx-auto mt-5 flex max-w-7xl flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-300/20 bg-slate-900/80 px-5 py-4 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">RyanAI · Personal welcome</p>
        <p className="mt-1 text-base font-semibold text-white">{greeting}</p>
        <p className="mt-1 text-xs text-slate-400" aria-live="polite">{voiceStatus}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ryanai-voice-choice">RyanAI English South African voice</label>
        <select
          id="ryanai-voice-choice"
          value={voiceUri}
          onChange={(event) => chooseVoice(event.target.value)}
          className="max-w-48 rounded-lg border border-white/15 bg-slate-950 px-2 py-2 text-xs text-slate-200"
          title="Choose RyanAI's device voice"
        >
          <option value="">Automatic South African voice</option>
          {availableVoices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={speak}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
        >
          <Volume2 className="h-4 w-4" /> Play greeting
        </button>
        <button
          type="button"
          onClick={toggleVoice}
          aria-pressed={voiceEnabled}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/5"
        >
          {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {voiceEnabled ? 'Voice on' : 'Voice off'}
        </button>
      </div>
    </section>
  );
}
