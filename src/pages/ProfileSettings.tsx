import { useState, type FormEvent } from 'react';
import { CheckCircle2, Globe2, Save, Volume2, LayoutDashboard, Calculator, BookAudio, Github, BrainCircuit, UserRound, LogOut, Code2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { DEFAULT_LANGUAGE, isRyanLanguage, RYANAI_LANGUAGES } from '@/shared/languages';
import { supabase } from '@/lib/supabase';
import { DEFAULT_MODEL, getAvailableModels, MODELS } from '@/lib/models';
import { AUDIOBOOK_SPEEDS, AUDIOBOOK_VOICES, DASHBOARD_UI_OPTIONS, normalizeAudiobookSettings, normalizeDashboardUiPreferences, normalizeInferenceSettings, type DashboardUiId } from '@/lib/settingsPreferences';
import GithubModal from '@/components/GithubModal';
import PluginIntegrationsSettings from '@/components/PluginIntegrationsSettings';

interface Props {
  userId: string; email: string; initialDisplayName: string; initialLanguage: string;
  initialVoiceEnabled?: boolean; initialDashboardUiIds?: string[]; initialDashboardUiPreferences?: unknown; initialAudiobookSettings?: unknown;
  initialInferenceSettings?: unknown; isAdmin?: boolean; isOwner?: boolean; onSignOut?: () => void; signingOut?: boolean;
}
export default function ProfileSettings({
  userId,
  email,
  initialDisplayName,
  initialLanguage,
  initialVoiceEnabled,
  initialDashboardUiIds,
  initialDashboardUiPreferences,
  initialAudiobookSettings,
  initialInferenceSettings,
  isOwner = false,
  isAdmin = false,
  onSignOut,
  signingOut = false,
}: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [language, setLanguage] = useState(isRyanLanguage(initialLanguage) ? initialLanguage : DEFAULT_LANGUAGE);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof initialVoiceEnabled === 'boolean') return initialVoiceEnabled;
    try { return (window.localStorage.getItem('ryanai:voice-enabled') ?? window.localStorage.getItem('ryanai:voice-greetings-enabled')) !== 'false'; } catch { return true; }
  });
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [dashboardUi, setDashboardUi] = useState(() => {
    const preferences = normalizeDashboardUiPreferences(initialDashboardUiPreferences);
    if (Array.isArray(initialDashboardUiIds)) {
      const selected = new Set(initialDashboardUiIds);
      for (const option of DASHBOARD_UI_OPTIONS) preferences[option.id] = selected.has(option.id);
      preferences.dashboard = true;
    }
    return preferences;
  });
  const [audiobookSettings, setAudiobookSettings] = useState(() => normalizeAudiobookSettings(initialAudiobookSettings));
  const [inferenceSettings, setInferenceSettings] = useState(() => normalizeInferenceSettings(initialInferenceSettings, Object.keys(MODELS), DEFAULT_MODEL));
  const [saving, setSaving] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const roleLabel = isOwner ? 'Owner' : isAdmin ? 'Administrator' : 'Standard user';
  const canManage = (id: DashboardUiId) => {
    const item = DASHBOARD_UI_OPTIONS.find(option => option.id === id);
    if (!item || !('access' in item)) return true;
    return item.access === 'admin' ? isAdmin : isOwner;
  };
  const changeModule = (id: DashboardUiId, enabled: boolean) => setDashboardUi(current => ({ ...current, [id]: enabled }));

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    if (!supabase) { setError('Settings cannot be saved because RyanAI authentication is not configured.'); return; }
    const name = displayName.trim();
    if (name.length > 100) { setError('Display name must be 100 characters or fewer.'); return; }
    if (!isRyanLanguage(language)) { setError('Choose a supported RyanAI language.'); return; }
    if (!Object.hasOwn(MODELS, inferenceSettings.preferredModel)) { setError('Choose a model from the supported RyanAI model catalogue.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity.user || identity.user.id !== userId) throw new Error('Your RyanAI session could not be verified. Sign in again before saving Settings.');
      const currentPrefs = normalizeDashboardUiPreferences(identity.user.user_metadata?.ryanai_dashboard_ui_preferences);
      const nextPrefs = { ...dashboardUi };
      for (const item of DASHBOARD_UI_OPTIONS) if (!canManage(item.id)) nextPrefs[item.id] = currentPrefs[item.id];
      const enabledIds = DASHBOARD_UI_OPTIONS.filter((option) => nextPrefs[option.id]).map((option) => option.id);
      const { data, error: updateError } = await supabase.auth.updateUser({ data: {
        full_name: name || null, ryanai_language: language, ryanai_voice_enabled: voiceEnabled,
        ryanai_dashboard_ui_preferences: nextPrefs, ryanai_dashboard_ui: enabledIds,
        ryanai_audiobook_settings: audiobookSettings, ryanai_inference_settings: inferenceSettings,
      }});
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) throw new Error('The identity provider did not confirm this Settings update.');
      try {
        window.localStorage.setItem(`ryanai:language:${userId}`, language); window.localStorage.setItem('ryanai:language', language);
        window.localStorage.setItem('ryanai:voice-enabled', String(voiceEnabled)); window.localStorage.setItem('ryanai:voice-greetings-enabled', String(voiceEnabled));
        window.localStorage.setItem(`ryanai:audiobook-settings:${userId}`, JSON.stringify(audiobookSettings));
      } catch { /* Account metadata remains authoritative. */ }
      window.dispatchEvent(new CustomEvent('ryanai:language-changed', { detail: { language } }));
      window.dispatchEvent(new CustomEvent('ryanai:voice-enabled-changed', { detail: { enabled: voiceEnabled } }));
      setNotice('RyanAI Settings were saved to your authenticated account.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Settings. Please retry.'); }
    finally { setSaving(false); }
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
    if (!currentPassword) {
      setError('Enter your current password to confirm this change.');
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
      const { data: identity, error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) throw signInError;
      if (!identity.user || identity.user.id !== userId) throw new Error('The identity provider could not re-verify this account.');
      const { data, error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this password update.');
      }
      setCurrentPassword('');
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

  const dashboardOptions = DASHBOARD_UI_OPTIONS.filter(({ id }) => !['calculator', 'audiobook', 'inferenceConsole'].includes(id));
  return <section className="mx-auto max-w-6xl space-y-6 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="profile-settings-title">
    <header><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Account</p><h1 id="profile-settings-title" className="mt-2 text-3xl font-bold text-white">Settings</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Manage dashboard visibility, your RyanAI profile, module preferences, GitHub authorization and inference defaults. Privileged access remains server-enforced.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}
    <PluginIntegrationsSettings userId={userId} initialPreferences={undefined} isAdmin={isAdmin} isOwner={isOwner} />
    <form onSubmit={saveSettings} className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="dashboard-ui-title">
        <div className="mb-5 flex items-center gap-3"><LayoutDashboard className="h-5 w-5 text-cyan-300" /><div><h2 id="dashboard-ui-title" className="font-semibold text-white">Dashboard UI options</h2><p className="mt-1 text-xs text-slate-400">Choose which workspaces appear in navigation and dashboard shortcuts. Settings always stays available.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2">{dashboardOptions.map(option => { const access = 'access' in option ? option.access : undefined; const permitted = canManage(option.id); return <label key={option.id} className={`flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 ${permitted ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input type="checkbox" data-testid={`ui-toggle-${option.id}`} checked={dashboardUi[option.id]} disabled={!permitted || saving} onChange={event => changeModule(option.id, event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><span className="block text-sm font-medium text-slate-200">{option.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>{!permitted && <span className="mt-1 block text-[11px] text-amber-300">Requires {access} access; preferences cannot grant access.</span>}</span>
        </label>; })}</div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="profile-management-title">
        <div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-cyan-300" /><div><h2 id="profile-management-title" className="font-semibold text-white">Profile management & access control</h2><p className="mt-1 text-xs text-slate-400">Edit personal identity and preferences. Roles are assigned separately by authorised administrators.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={100} autoComplete="name" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /><span className="mt-1 block text-[11px] text-slate-500">Used for your RyanAI workspace identity.</span></label><label className="block text-sm text-slate-300">Signed-in email<input value={email} readOnly aria-readonly="true" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-400" /><span className="mt-1 block text-[11px] text-slate-500">Email changes remain managed by the authentication provider.</span></label></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-[11px] uppercase tracking-wider text-slate-500">Assigned access role</p><p className="mt-1 text-sm font-semibold text-cyan-100">{roleLabel}</p><p className="mt-1 text-xs text-slate-500">Read-only. Role and owner claims cannot be edited here.</p></div><div className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-[11px] uppercase tracking-wider text-slate-500">Account reference</p><p className="mt-1 break-all text-sm text-slate-200">{userId}</p></div></div>
        <div className="mt-5 border-t border-white/10 pt-5"><div className="mb-4 flex items-center gap-3"><Globe2 className="h-5 w-5 text-cyan-300" /><div><h3 className="font-semibold text-white">Language preferences</h3><p className="mt-1 text-xs text-slate-400">Preferred language for voice input and responses where supported.</p></div></div><label className="block max-w-xl text-sm text-slate-300">Preferred language<select value={language} onChange={event => setLanguage(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><optgroup label="South African languages">{RYANAI_LANGUAGES.filter(item => item.region === 'South Africa').map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup><optgroup label="International languages">{RYANAI_LANGUAGES.filter(item => item.region === 'International').map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup></select></label></div>
        <div className="mt-5 border-t border-white/10 pt-5"><div className="mb-4 flex items-center gap-3"><Volume2 className="h-5 w-5 text-cyan-300" /><div><h3 className="font-semibold text-white">Voice preferences</h3><p className="mt-1 text-xs text-slate-400">Control automatic spoken greetings.</p></div></div><label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="voice-enabled-toggle" checked={voiceEnabled} onChange={event => setVoiceEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><span className="block text-sm font-medium text-slate-200">Speak my RyanAI welcome greeting</span><span className="mt-1 block text-xs leading-5 text-slate-500">Voice availability depends on device and language.</span></span></label></div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="studio-profile-title"><div className="mb-4 flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-300" /><div><h2 id="studio-profile-title" className="font-semibold text-white">RyanAI Studio profile & session</h2><p className="mt-1 text-xs text-slate-400">Studio uses the same authenticated RyanAI account; it has no separate credential store.</p></div></div><div className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-white">Signed in as {displayName || email || 'RyanAI user'}</p><p className="mt-1 text-xs text-slate-500">{email} · {roleLabel} access</p></div>{isAdmin ? <a href="#/studio" className="rounded-lg border border-cyan-300/20 px-3 py-2 text-xs font-semibold text-cyan-100">Open RyanAI Studio</a> : <span className="text-xs text-slate-500">Studio access requires an assigned administrator role.</span>}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><p className="max-w-xl text-xs leading-5 text-slate-500">Sign in and sign up are shared with the RyanAI account gateway. Sign out to switch accounts or return to the sign-in/sign-up screen.</p><button type="button" onClick={onSignOut} disabled={!onSignOut || signingOut} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50"><LogOut className="h-4 w-4" />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div><p className="mt-3 text-xs leading-5 text-slate-500">Roles, account suspension and privileged permissions remain server-side. Preferences cannot grant Studio, Admin or Owner access.</p></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="calculator-settings-title"><div className="mb-4 flex items-center gap-3"><Calculator className="h-5 w-5 text-cyan-300" /><div><h2 id="calculator-settings-title" className="font-semibold text-white">Calculator</h2><p className="mt-1 text-xs text-slate-400">Show or hide the local arithmetic calculator workspace.</p></div></div><label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="calculator-enabled-toggle" checked={dashboardUi.calculator} disabled={saving} onChange={event => changeModule('calculator', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Calculator</span></label></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="audiobook-settings-title"><div className="mb-4 flex items-center gap-3"><BookAudio className="h-5 w-5 text-cyan-300" /><div><h2 id="audiobook-settings-title" className="font-semibold text-white">Audiobooks</h2><p className="mt-1 text-xs text-slate-400">Manage Audiobook Studio visibility and default narration settings.</p></div></div><label className="mb-4 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="audiobook-enabled-toggle" checked={dashboardUi.audiobook} disabled={saving} onChange={event => changeModule('audiobook', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Audiobook Studio</span></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Default narration voice<select data-testid="audiobook-default-voice" value={audiobookSettings.defaultVoice} disabled={saving} onChange={event => setAudiobookSettings(current => ({ ...current, defaultVoice: event.target.value as typeof current.defaultVoice }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{AUDIOBOOK_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}</select></label><label className="block text-sm text-slate-300">Default narration speed<select value={String(audiobookSettings.narrationSpeed)} disabled={saving} onChange={event => setAudiobookSettings(current => ({ ...current, narrationSpeed: Number(event.target.value) as typeof current.narrationSpeed }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{AUDIOBOOK_SPEEDS.map(speed => <option key={speed} value={speed}>{speed.toFixed(1)}×</option>)}</select></label></div></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="github-settings-title"><div className="mb-4 flex items-center gap-3"><Github className="h-5 w-5 text-cyan-300" /><div><h2 id="github-settings-title" className="font-semibold text-white">GitHub authorization & access</h2><p className="mt-1 text-xs text-slate-400">Authorize, connect, verify or disconnect your GitHub account.</p></div></div><p className="text-sm leading-6 text-slate-400">RyanAI verifies GitHub identity and repository access before reporting a connection as active. This integration provides status/read access only, not write, merge or deployment authority.</p><button type="button" onClick={() => setGithubOpen(true)} className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-4 py-2.5 text-sm font-semibold text-cyan-100">Open GitHub connection settings</button></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="inference-settings-title"><div className="mb-4 flex items-center gap-3"><BrainCircuit className="h-5 w-5 text-cyan-300" /><div><h2 id="inference-settings-title" className="font-semibold text-white">Inference Console settings</h2><p className="mt-1 text-xs text-slate-400">Control Workspace console visibility and choose its default model.</p></div></div><label className="mb-4 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="inference-console-enabled-toggle" checked={dashboardUi.inferenceConsole} disabled={saving} onChange={event => changeModule('inferenceConsole', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Inference Console in Workspace</span></label><label className="block max-w-xl text-sm text-slate-300">Preferred default model<select data-testid="inference-default-model" value={inferenceSettings.preferredModel} disabled={saving} onChange={event => setInferenceSettings({ preferredModel: event.target.value })} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{getAvailableModels().map(model => <option key={model.id} value={model.id}>{model.label} · {model.provider}</option>)}</select></label><p className="mt-3 text-xs leading-5 text-slate-500">The chosen model is the console's initial selection. Provider availability and authorization remain controlled by RyanAI API policy.</p></section>
      <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4"><h2 className="text-sm font-semibold text-cyan-100">Credential and permission safety</h2><p className="mt-1 text-xs leading-5 text-slate-400">Provider API keys, GitHub client secrets, access tokens and encryption keys are never displayed or edited here. Roles and privileged access cannot be changed through account preferences.</p></section>
      <div className="flex justify-end"><button type="submit" disabled={saving || !isRyanLanguage(language) || !Object.hasOwn(MODELS, inferenceSettings.preferredModel)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving Settings…' : 'Save all Settings'}</button></div>
    </form>
    <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="account-security-title">
      <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-cyan-300" /><div><h2 id="account-security-title" className="font-semibold text-white">Account security</h2><p className="mt-1 text-xs text-slate-400">Email and password changes are verified by Supabase Auth.</p></div></div>
      <form onSubmit={requestEmailChange} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block text-sm text-slate-300">New email address<input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <button type="submit" disabled={savingEmail || !newEmail.trim()} className="self-end rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50">{savingEmail ? 'Requesting…' : 'Request email change'}</button>
      </form>
      <form onSubmit={changePassword} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">Current password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <label className="block text-sm text-slate-300">New password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <label className="block text-sm text-slate-300 sm:col-span-2">Confirm new password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <button type="submit" disabled={savingPassword || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50 sm:col-span-2"><LockKeyhole className="h-4 w-4" />{savingPassword ? 'Updating…' : 'Update password'}</button>
      </form>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
        <div><h3 className="text-sm font-medium text-slate-200">Other signed-in devices</h3><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Invalidate other refresh-token sessions while keeping this device signed in. Previously issued access tokens may remain valid until they expire.</p></div>
        <button type="button" onClick={() => void signOutOtherDevices()} disabled={revokingSessions} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"><LogOut className="h-4 w-4" />{revokingSessions ? 'Signing out…' : 'Sign out other devices'}</button>
      </div>
    </section>
    <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
      <h2 className="text-sm font-semibold text-cyan-100">Provider and integration security</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">Provider credentials, billing settings, administrator roles, owner claims and external integration secrets are not editable here. Account deletion requires a verified server-side process and is not exposed as a client-side action.</p>
    </section>
    <GithubModal open={githubOpen} onClose={() => setGithubOpen(false)} />
  </section>;
}
