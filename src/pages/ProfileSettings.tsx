import { useState, type FormEvent } from 'react';
import { CheckCircle2, Globe2, Save, ShieldCheck, Volume2 } from 'lucide-react';
import { DEFAULT_LANGUAGE, isRyanLanguage, RYANAI_LANGUAGES } from '@/shared/languages';
import { supabase } from '@/lib/supabase';

interface ProfileSettingsProps {
  userId: string;
  email: string;
  initialDisplayName: string;
  initialLanguage: string;
  initialVoiceEnabled?: boolean;
}

/**
 * Edit only user-owned Supabase auth metadata. Administrative roles, owner
 * claims, provider credentials and integration secrets are never editable here.
 */

function getProfileValidationError(displayName: string, language: string): string | null {
  if (!supabase) {
    return 'Profile updates are unavailable because Supabase authentication is not configured.';
  }
  if (displayName.trim().length > 100) {
    return 'Display name must be 100 characters or fewer.';
  }
  if (!isRyanLanguage(language)) {
    return 'Choose a supported RyanAI language.';
  }
  return null;
}

interface PersistProfilePreferencesOptions {
  userId: string;
  displayName: string;
  language: string;
  voiceEnabled: boolean;
}

async function persistProfilePreferences({
  userId,
  displayName,
  language,
  voiceEnabled,
}: PersistProfilePreferencesOptions): Promise<void> {
  const client = supabase;
  if (!client) {
    throw new Error('Profile updates are unavailable because Supabase authentication is not configured.');
  }

  const { data, error } = await client.auth.updateUser({
    data: {
      full_name: displayName || null,
      ryanai_language: language,
      ryanai_voice_enabled: voiceEnabled,
    },
  });
  if (error) throw error;
  if (!data.user || data.user.id !== userId) {
    throw new Error('The identity provider did not confirm this profile update.');
  }

  try {
    window.localStorage.setItem('ryanai:language:' + userId, language);
    window.localStorage.setItem('ryanai:language', language);
    window.localStorage.setItem('ryanai:voice-enabled', String(voiceEnabled));
    window.localStorage.setItem('ryanai:voice-greetings-enabled', String(voiceEnabled));
  } catch {
    // Supabase metadata is authoritative; device storage is only a compatibility cache.
  }
  window.dispatchEvent(new CustomEvent('ryanai:language-changed', { detail: { language } }));
  window.dispatchEvent(new CustomEvent('ryanai:voice-enabled-changed', { detail: { enabled: voiceEnabled } }));
}

export default function ProfileSettings({
  userId,
  email,
  initialDisplayName,
  initialLanguage,
  initialVoiceEnabled,
}: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [language, setLanguage] = useState(
    isRyanLanguage(initialLanguage) ? initialLanguage : DEFAULT_LANGUAGE,
  );
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof initialVoiceEnabled === 'boolean') return initialVoiceEnabled;
    try {
      const stored = window.localStorage.getItem('ryanai:voice-enabled')
        ?? window.localStorage.getItem('ryanai:voice-greetings-enabled');
      return stored !== 'false';
    } catch {
      return true;
    }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const validationError = getProfileValidationError(displayName, language);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      await persistProfilePreferences({
        userId,
        displayName: displayName.trim(),
        language,
        voiceEnabled,
      });
      setNotice('Profile and preferences saved to your authenticated RyanAI account.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your profile. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="profile-settings-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Account</p>
        <h1 id="profile-settings-title" className="mt-2 text-3xl font-bold text-white">Profile & settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Manage your account display name, response language and greeting voice preferences. Changes are saved through your signed-in Supabase account.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

      <form onSubmit={saveProfile} className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="profile-details-title">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 id="profile-details-title" className="font-semibold text-white">Account profile</h2>
              <p className="mt-1 text-xs text-slate-400">Your account identity is verified by Supabase Auth.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)}
                maxLength={100} autoComplete="name"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none" />
              <span className="mt-1 block text-[11px] text-slate-500">Used for your RyanAI welcome and workspace identity.</span>
            </label>
            <label className="block text-sm text-slate-300">
              Signed-in email
              <input value={email} readOnly aria-readonly="true"
                className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-400" />
              <span className="mt-1 block text-[11px] text-slate-500">Email changes are managed through your authentication provider.</span>
            </label>
          </div>
          <p className="mt-3 text-[11px] text-slate-600">Account reference: {userId}</p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="language-preferences-title">
          <div className="mb-5 flex items-center gap-3">
            <Globe2 className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 id="language-preferences-title" className="font-semibold text-white">Language preferences</h2>
              <p className="mt-1 text-xs text-slate-400">Use your preferred language for voice input and RyanAI responses where the active model supports it.</p>
            </div>
          </div>
          <label className="block max-w-xl text-sm text-slate-300">
            Preferred language
            <select value={language} onChange={(event) => setLanguage(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none">
              <optgroup label="South African languages">
                {RYANAI_LANGUAGES.filter((item) => item.region === 'South Africa').map((item) =>
                  <option key={item.code} value={item.code}>{item.name}</option>,
                )}
              </optgroup>
              <optgroup label="International languages">
                {RYANAI_LANGUAGES.filter((item) => item.region === 'International').map((item) =>
                  <option key={item.code} value={item.code}>{item.name}</option>,
                )}
              </optgroup>
            </select>
          </label>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded border border-cyan-300/20 px-2 py-1">{language}</span>
            <span>Preference is stored in your account and synced to the active workspace.</span>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="voice-preferences-title">
          <div className="mb-4 flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 id="voice-preferences-title" className="font-semibold text-white">Voice preferences</h2>
              <p className="mt-1 text-xs text-slate-400">Control automatic spoken greetings on this and compatible devices.</p>
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-cyan-400" />
            <span>
              <span className="block text-sm font-medium text-slate-200">Speak my RyanAI welcome greeting</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">When enabled, RyanAI uses the device's available speech voice. Voice availability and pronunciation depend on the device and language.</span>
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
          <h2 className="text-sm font-semibold text-cyan-100">Provider and integration security</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Provider credentials, billing settings and external integration secrets are not editable here. They remain server-side and are managed by an authorised administrator. Never paste API keys into profile fields or chat.
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="submit" disabled={saving || !isRyanLanguage(language)}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
            <Save className="h-4 w-4" /> {saving ? 'Saving profile…' : 'Save profile & preferences'}
          </button>
        </div>
      </form>
    </section>
  );
}
