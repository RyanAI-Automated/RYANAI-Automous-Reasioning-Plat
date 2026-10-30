import { lazy, Suspense, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Cpu,
  LayoutDashboard,
  MessageSquareText,
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
const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const AuthPage = lazy(() => import('@/pages/AuthPage'));
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
  return (
    appManifest.routes.find((candidate) => candidate.id === route)?.id ??
    UI_CONFIG.defaultRoute
  );
};

const routeIcons: Record<Route, LucideIcon> = {
  landing: Orbit,
  signin: LogIn,
  signup: UserPlus,
  dashboard: LayoutDashboard,
  cockpit: Cpu,
  workspace: MessageSquareText,
};

const destinations = appManifest.routes.map((route) => ({
  ...route,
  icon: routeIcons[route.id],
}));

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [verifiedIdentity, setVerifiedIdentity] = useState<{ userId: string; isOwner: boolean; displayName?: string } | null>(null);
  const { session, loading, error, signingOut, signOut } = useAuth();
  const isAuthRoute = route === 'signin' || route === 'signup';
  const user = session?.user;
  const userId = user?.id;
  const userEmail = user?.email;
  const ownerClaim = user?.app_metadata?.owner === true;
  const isAdmin = user?.app_metadata?.role === 'admin';
  const isOwner = user?.app_metadata?.owner === true || Boolean(user && verifiedIdentity?.userId === user.id && verifiedIdentity.isOwner);
  const displayName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : user?.email?.split('@')[0];

  const handleSignOut = async () => {
    if (await signOut()) window.location.hash = '/signin';
  };

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void authenticatedFetch('/api/auth/verify')
      .then(async (response) => {
        if (!response.ok) throw new Error('Identity verification unavailable');
        return response.json() as Promise<{ user?: { isOwner?: boolean; displayName?: string } }>;
      })
      .then((result) => {
        if (active) setVerifiedIdentity({
          userId,
          isOwner: result.user?.isOwner === true,
          displayName: result.user?.displayName,
        });
      })
      .catch(() => {
        if (active) setVerifiedIdentity({
          userId: user.id,
          isOwner: ownerClaim,
          displayName,
        });
      });
    return () => { active = false; };
  }, [userId, userEmail, ownerClaim, displayName]);

  useEffect(() => {
    if (session && isAuthRoute) window.location.hash = '/workspace';
  }, [session, isAuthRoute]);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  return (
    <div className="flex h-screen min-h-[480px] flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="z-20 flex min-h-14 items-center justify-between border-b border-cyan-400/15 bg-slate-950/95 px-4 sm:px-8">
        <a
          href="#/"
          className="flex items-center gap-2 font-display text-sm font-black tracking-[0.18em] text-cyan-200"
        >
          <Cpu className="h-5 w-5 text-cyan-400" />
          RYANAI
        </a>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {destinations
            .filter(({ id }) => !user || (id !== 'signin' && id !== 'signup'))
            .map(({ id, path, label, icon: Icon }) => (
              <a
                key={id}
                href={id === 'landing' ? '#/' : `#${path}`}
                aria-label={label}
                aria-current={route === id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                  route === id
                    ? 'bg-cyan-400/10 text-cyan-200'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </a>
            ))}
          {user && (
            <>
              <span className="hidden px-2 text-xs text-slate-300 md:inline">
                {displayName}
              </span>
              <button
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="shrink-0 rounded-lg px-3 py-2 text-sm text-cyan-200 disabled:opacity-50"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          )}
        </nav>
      </header>

      <Suspense fallback={<p role="status" className="p-8 text-slate-300">Loading RyanAI workspace…</p>}>
      <main
        key={user?.id ?? 'signed-out'}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {user && verifiedIdentity?.userId === user.id && (
          <Greeting
            userId={user.id}
            displayName={verifiedIdentity.displayName || displayName}
            isOwner={isOwner}
            preferredTitle={typeof user.user_metadata?.preferred_title === 'string' ? user.user_metadata.preferred_title : isOwner ? 'Sir G' : ''}
            preferredLanguage={typeof user.user_metadata?.preferred_language === 'string' ? user.user_metadata.preferred_language : 'en-ZA'}
            preferredVoiceLanguage={typeof user.user_metadata?.preferred_voice_language === 'string' ? user.user_metadata.preferred_voice_language : isOwner ? 've-ZA' : 'en-ZA'}
          />
        )}
        {error && (
          <p role="alert" className="p-4 text-rose-300">
            {error}
          </p>
        )}
        {route === 'landing' ? (
          <LandingPage />
        ) : loading ? (
          <p role="status" className="p-8 text-slate-300">
            Restoring your session…
          </p>
        ) : !user ? (
          <AuthPage
            key={route}
            mode={route === 'signup' ? 'signup' : 'signin'}
          />
        ) : (
          <>
            {route === 'dashboard' && <DashboardPage />}
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
              <div className="h-full min-h-[calc(100vh-3.5rem)]">
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
  );
}
