import { lazy, Suspense, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Cpu,
  LayoutDashboard,
  TrendingUp,
  MessageSquareText,
  BookAudio,
  Mail,
  Orbit,
  LogIn,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import appManifest from '../app/routes.json';
import { UI_CONFIG } from '@/config/core';
const RyanAICockpit = lazy(() => import('@/components/dashboard/RyanAICockpit'));
const AgentControlPanel = lazy(() => import('@/components/AgentControlPanel').then((module) => ({ default: module.AgentControlPanel })));
const BrainKnowledgePanel = lazy(() => import('@/components/BrainKnowledgePanel'));
const SelfPatchPanel = lazy(() => import('@/components/SelfPatchPanel'));
const CommandCenter = lazy(() => import('@/pages/CommandCenter.tsx'));
const CommunicationsCenter = lazy(() => import('@/components/CommunicationsCenter'));
const AudiobookStudio = lazy(() => import('@/pages/AudiobookStudio'));
const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const QuantLabPage = lazy(() => import('@/pages/QuantLab'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const AuthPage = lazy(() => import('@/pages/AuthPage'));
const OAuthConsentPage = lazy(() => import('@/pages/OAuthConsentPage'));
import { useAuth } from '@/hooks/useAuth';
import { Analytics } from '@vercel/analytics/react';
import Greeting from '@/components/Greeting';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type Route = (typeof appManifest.routes)[number]['id'];

/**
 * Resolve the first hash path segment, mapping login/register to signin/signup.
 * Unknown segments use the configured default route.
 */
const routeFromHash = (): Route => {
  const segment = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  const route =
    segment === 'login'
      ? 'signin'
      : segment === 'register'
        ? 'signup'
        : segment;
  const visibleDestinations = destinations.filter(({ id }) =>
    user
      ? id !== 'signin' && id !== 'signup' && (id !== 'comms' || isOwner)
      : id === 'landing' || id === 'signin' || id === 'signup',
  );
  const currentTitle = destinations.find(({ id }) => id === route)?.label ?? 'Workspace';

  return (
    <div className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-[#0D0E15] text-[#F8FAFC] md:flex-row">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="relative z-30 hidden w-[252px] shrink-0 flex-col border-r border-cyan-300/10 bg-[#0a0d14] md:flex">
        <a href="#/" className="flex min-h-[76px] items-center gap-3 border-b border-white/5 px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-[0_0_24px_rgba(0,242,254,0.12)]">
            <Cpu className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-black tracking-[0.2em] text-cyan-100">RYANAI</span>
            <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Autonomous platform</span>
          </span>
        </a>

        <div className="px-5 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
          Platform
        </div>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleDestinations.map(({ id, path, label, icon: Icon }) => (
            <a
              key={id}
              href={id === 'landing' ? '#/' : `#${path}`}
              aria-current={route === id ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                route === id
                  ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[inset_2px_0_0_#00F2FE]'
                  : 'border-transparent text-slate-400 hover:border-white/5 hover:bg-white/[0.04] hover:text-slate-100'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${route === id ? 'text-cyan-300' : 'text-slate-500 group-hover:text-cyan-200'}`} />
              <span>{label}</span>
              {route === id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(0,242,254,0.8)]" />}
            </a>
          ))}
        </nav>

        <div className="border-t border-white/5 p-4">
          {user ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/20 to-blue-400/20 text-xs font-bold text-cyan-100">
                {(displayName || 'R').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-200">{displayName || 'Signed-in operator'}</span>
                <span className="mt-1 block text-[9px] uppercase tracking-wider text-slate-500">{isOwner ? 'Owner session' : isAdmin ? 'Admin session' : 'Authenticated session'}</span>
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                aria-label="Sign out"
                title="Sign out"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4 rotate-180" />
              </button>
            </div>
          ) : (
            <p className="px-2 py-2 text-[11px] text-slate-600">Secure sign-in required for operator tools.</p>
          )}
          <p className="mt-3 px-2 text-[9px] font-mono uppercase tracking-[0.14em] text-slate-700">RyanAI · {APP_ENV.toUpperCase()}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 shrink-0 border-b border-cyan-300/10 bg-[#0d111b]/95 shadow-[0_8px_32px_rgba(0,0,0,0.16)] backdrop-blur-xl">
          <div className="hidden min-h-[64px] items-center justify-between gap-4 px-6 md:flex xl:px-9">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">RyanAI / Platform</p>
              <p className="mt-1 text-sm font-semibold text-slate-200">{currentTitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-200/80">Operator console</span>
              {user && <span className="max-w-[220px] truncate text-xs text-slate-500">{displayName}</span>}
              {user && (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-rose-300/20 hover:bg-rose-300/5 hover:text-rose-200 disabled:opacity-50"
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </div>
          </div>

          <div className="flex min-h-[58px] items-center justify-between gap-3 px-4 md:hidden">
            <a href="#/" className="flex min-w-0 items-center gap-2 font-display text-sm font-black tracking-[0.18em] text-cyan-100">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-300"><Cpu className="h-4 w-4" /></span>
              RYANAI
            </a>
            <div className="flex min-w-0 items-center gap-2">
              {user && <span className="max-w-[140px] truncate text-[11px] text-slate-500">{displayName}</span>}
              {user && (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  aria-label="Sign out"
                  className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-50"
                >
                  {signingOut ? '…' : 'Sign out'}
                </button>
              )}
            </div>
          </div>

          <nav aria-label="Mobile navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 md:hidden">
            {visibleDestinations.map(({ id, path, label, icon: Icon }) => (
              <a
                key={id}
                href={id === 'landing' ? '#/' : `#${path}`}
                aria-label={label}
                aria-current={route === id ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors ${
                  route === id
                    ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </header>

        <Suspense fallback={<p role="status" className="p-8 text-slate-300">Loading RyanAI workspace…</p>}>
          <main
            id="main-content"
            key={user?.id ?? 'signed-out'}
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
          >
            {user && verifiedIdentity?.userId === user.id && <Greeting userId={user.id} displayName={verifiedIdentity.displayName || displayName} isOwner={isOwner} />}
            {error && (
              <p role="alert" className="p-4 text-rose-300">
                {error}
              </p>
            )}
            {isOAuthConsentRoute ? (
              loading ? (
                <p role="status" className="p-8 text-slate-300">Restoring your session before authorization…</p>
              ) : user ? (
                <OAuthConsentPage key={user.id} userId={user.id} />
              ) : (
                <AuthPage key="oauth-signin" mode="signin" />
              )
            ) : route === 'landing' ? (
              <LandingPage />
            ) : loading ? (
              <p role="status" className="p-8 text-slate-300">Restoring your session…</p>
            ) : !user ? (
              <AuthPage key={route} mode={route === 'signup' ? 'signup' : 'signin'} />
            ) : (
              <>
                {route === 'dashboard' && <DashboardPage />}
                {route === 'quant' && <QuantLabPage />}
                {route === 'comms' && (isOwner ? <CommunicationsCenter /> : <p role="alert" className="p-8 text-sm text-rose-200">Owner access is required to open RyanAI Comms.</p>)}
                {route === 'audiobook' && <AudiobookStudio key={user.id} userId={user.id} />}
                {route === 'cockpit' && (
                  <>
                    <RyanAICockpit />
                    {isAdmin && (
                      <>
                        <BrainKnowledgePanel />
                        <SelfPatchPanel />
                      </>
                    )}
                    {isTauri() && <AgentControlPanel />}
                  </>
                )}
                {(route === 'workspace' || isAuthRoute) && (
                  <div className="min-h-0">
                    <CommandCenter
                      onSignOut={() => void handleSignOut()}
                      userId={user.id}
                      userEmail={user.email!}
                      userFullName={displayName}
                    />
                  </div>
                )}
              </>
            )}
          </main>
        </Suspense>
        <Analytics />
      </div>
    </div>
  );
}
