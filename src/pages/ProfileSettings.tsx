import { useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Eye,
  Globe2,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Save,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { DEFAULT_LANGUAGE, isRyanLanguage, RYANAI_LANGUAGES } from '@/shared/languages';
import { getAvailableDashboardUiOptions } from '@/shared/dashboardUis';
import { supabase } from '@/lib/supabase';

interface ProfileSettingsProps {
  userId: string;
  email: string;
  initialDisplayName: string;
  initialLanguage: string;
  initialVoiceEnabled?: boolean;
  initialDashboardUiIds: string[];
  isOwner?: boolean;
  isAdmin?: boolean;
}

/**
 * Edit only user-owned Supabase auth metadata. Workspace visibility is a
 * preference, not an authorization grant. Administrative roles, owner claims,
 * provider credentials and integration secrets are never editable here.
 */
export default function ProfileSettings({
  userId,
  email,
  initialDisplayName,
  initialLanguage,
  initialVoiceEnabled,
  initialDashboardUiIds,
  isOwner = false,
  isAdmin = false,
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
  const [enabledUiIds, setEnabledUiIds] = useState<Set<string>>(
    () => new Set(initialDashboardUiIds),
  );
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const dashboardUiOptions = getAvailableDashboardUiOptions(isOwner, isAdmin);

  function toggleDashboardUi(id: string, enabled: boolean) {
    setEnabledUiIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingProfile) return;
    if (!supabase) {
      setError('Profile updates are unavailable because Supabase authentication is not configured.');
      return;
    }

    const nextName = displayName.trim();
    if (nextName.length > 100) {
      setError('Display name must be 100 characters or fewer.');
      return;
    }
    if (!isRyanLanguage(language)) {
      setError('Choose a supported RyanAI language.');
      return;
    }

    const nextDashboardUiIds = dashboardUiOptions
      .filter((option) => enabledUiIds.has(option.id))
      .map((option) => option.id);

    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: {
          full_name: nextName || null,
          ryanai_language: language,
          ryanai_voice_enabled: voiceEnabled,
          ryanai_dashboard_ui: nextDashboardUiIds,
        },
      });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this profile update.');
      }

      try {
        window.localStorage.setItem(`ryanai:language:${userId}`, language);
        window.localStorage.setItem('ryanai:language', language);
        window.localStorage.setItem('ryanai:voice-enabled', String(voiceEnabled));
        window.localStorage.setItem('ryanai:voice-greetings-enabled', String(voiceEnabled));
      } catch {
        // Supabase metadata is authoritative; device storage is only a compatibility cache.
      }
      window.dispatchEvent(new CustomEvent('ryanai:language-changed', { detail: { language } }));
      window.dispatchEvent(new CustomEvent('ryanai:voice-enabled-changed', { detail: { enabled: voiceEnabled } }));
      setNotice('Profile, dashboard visibility and preferences saved to your authenticated RyanAI account.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your profile. Please retry.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingEmail) return;
    if (!supabase) {
      setError('Email updates are unavailable because Supabase authentication is not configured.');
      return;
    }

    const nextEmail = newEmail.trim().toLowerCase();
    if (!nextEmail || nextEmail === email.trim().toLowerCase()) {
      setError('Enter a different email address before requesting a change.');
      return;
    }

    setSavingEmail(true);
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ email: nextEmail });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this email-change request.');
      }
      setNewEmail('');
      setNotice('Email change request accepted. Complete the verification steps from your authentication provider before the new address becomes active.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request an email change. Please retry.');
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;
    if (!supabase) {
      setError('Password updates are unavailable because Supabase authentication is not configured.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Use a password with at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }

    setSavingPassword(true);
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this password update.');
      }
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password update confirmed by Supabase Auth.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your password. Please retry.');
    } finally {
      setSavingPassword(false);
    }
  }

  async function signOutOtherDevices() {
    if (revokingSessions) return;
    if (!supabase) {
      setError('Session management is unavailable because Supabase authentication is not configured.');
      return;
    }

    setRevokingSessions(true);
    setError('');
    setNotice('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) throw signOutError;
      setNotice('Other refresh-token sessions have been invalidated. This device remains signed in.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out other devices. Please retry.');
    } finally {
      setRevokingSessions(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="profile-settings-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Account</p>
        <h1 id="profile-settings-title" className="mt-2 text-3xl font-bold text-white">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Manage your RyanAI workspaces, profile identity, sign-in details and personal preferences.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

      <form onSubmit={saveProfile} className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="dashboard-ui-title">
          <div className="mb-4 flex items-center gap-3">
            <LayoutDashboard className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 id="dashboard-ui-title" className="font-semibold text-white">Dashboard UI options</h2>
              <p className="mt-1 text-xs text-slate-400">Choose which RyanAI workspaces appear in your dashboard and navigation.</p>
            </div>
          </div>
          <p className="mb-4 text-xs leading-5 text-slate-500">
            Dashboard and Settings always remain available. Turning a workspace off also blocks its direct in-app route for this account; role-based access checks still apply.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {dashboardUiOptions.map((option) => (
              <label key={option.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <input
                  type="checkbox"
                  data-ui-id={option.id}
                  checked={enabledUiIds.has(option.id)}
                  onChange={(event) => toggleDashboardUi(option.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-cyan-400"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-200">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="profile-details-title">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            <div>
              <h2 id="profile-details-title" className="font-semibold text-white">Profile information</h2>
              <p className="mt-1 text-xs text-slate-400">Your account identity is verified by Supabase Auth.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={100}
                autoComplete="name"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none"
              />
              <span className="mt-1 block text-[11px] text-slate-500">Used for your RyanAI welcome and workspace identity.</span>
            </label>
            <label className="block text-sm text-slate-300">
              Signed-in email
              <input value={email} readOnly aria-readonly="true" className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-400" />
              <span className="mt-1 block text-[11px] text-slate-500">Use Account security below to request an email change.</span>
            </label>
          </div>
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
            <select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none">
              <optgroup label="South African languages">
                {RYANAI_LANGUAGES.filter((item) => item.region === 'South Africa').map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))}
              </optgroup>
              <optgroup label="International languages">
                {RYANAI_LANGUAGES.filter((item) => item.region === 'International').map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))}
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
            <input
              type="checkbox"
              data-testid="voice-enabled"
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-cyan-400"
            />
            <span>
              <span className="block text-sm font-medium text-slate-200">Speak my RyanAI welcome greeting</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">When enabled, RyanAI uses the device's available speech voice. Voice availability and pronunciation depend on the device and language.</span>
            </span>
          </label>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="submit" disabled={savingProfile || !isRyanLanguage(language)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
            <Save className="h-4 w-4" /> {savingProfile ? 'Saving settings…' : 'Save profile & dashboard settings'}
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="account-security-title">
        <div className="mb-5 flex items-center gap-3">
          <LockKeyhole className="h-5 w-5 text-cyan-300" />
          <div>
            <h2 id="account-security-title" className="font-semibold text-white">Account security</h2>
            <p className="mt-1 text-xs text-slate-400">Email and password changes are handled by your authenticated identity provider.</p>
          </div>
        </div>

        <form onSubmit={requestEmailChange} className="grid gap-3 border-b border-white/5 pb-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-sm text-slate-300">
            New email address
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              autoComplete="email"
              required
              placeholder="name@example.com"
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-slate-500">Verification is required before the new email becomes active.</span>
          </label>
          <button type="submit" disabled={savingEmail || !newEmail.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
            <Mail className="h-4 w-4" /> {savingEmail ? 'Requesting…' : 'Request email change'}
          </button>
        </form>

        <form onSubmit={changePassword} className="grid gap-3 pt-5 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-300 focus:outline-none"
            />
          </label>
          <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Use at least 12 characters. Your identity provider may require recent authentication before a password change.</p>
          <div className="sm:col-span-2">
            <button type="submit" disabled={savingPassword || newPassword.length < 12 || !confirmPassword} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
              <LockKeyhole className="h-4 w-4" /> {savingPassword ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
          <div>
            <h3 className="text-sm font-medium text-slate-200">Other signed-in devices</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Invalidate other refresh-token sessions while keeping this device signed in. Previously issued access tokens may remain valid until they expire.</p>
          </div>
          <button type="button" onClick={() => void signOutOtherDevices()} disabled={revokingSessions} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">
            <LogOut className="h-4 w-4" /> {revokingSessions ? 'Signing out…' : 'Sign out other devices'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
        <h2 className="text-sm font-semibold text-cyan-100">Provider and integration security</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Provider credentials, billing settings, administrator roles, owner claims and external integration secrets are not editable here. They remain server-side and are managed through authorised administrative workflows. Account deletion also requires a verified server-side process; it is not exposed as a client-side profile action.
        </p>
      </section>
    </section>
  );
}
