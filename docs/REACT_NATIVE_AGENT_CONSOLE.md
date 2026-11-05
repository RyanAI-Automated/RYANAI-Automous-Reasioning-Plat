# React Native Agent Console integration

## Current repository boundary

This repository contains the reusable `src/screens/AgentConsoleScreen.tsx` source and its API client, but does not contain a React Native application entry point, navigation tree, Supabase mobile client, or native secure-storage adapter. The screen is therefore a host-integrated component, not a standalone installable mobile app.

## Required host contract

Mount the screen from the mobile app and supply a `getSession` function. It must read the current signed-in Supabase session from the app's own Supabase client, configured with the platform's approved secure session storage. It must return the current access token and anonymous-session state, or `null` when signed out:

```ts
import type { MobileAuthSession } from "./services/mobileApiClient";

async function getSession(): Promise<MobileAuthSession | null> {
  const { data, error } = await mobileSupabase.auth.getSession();
  const session = data.session;

  if (error || !session) return null;

  return {
    accessToken: session.access_token,
    isAnonymous: session.user.is_anonymous,
  };
}
```

The mobile host should pass this function to `AgentConsoleScreen`:

```tsx
<AgentConsoleScreen getSession={getSession} />
```

Do not store or copy bearer tokens inside the screen or API client. Resolve the session at submit time. The token is held only for the request and sent to the API in the Authorization header.

## API contract

The client posts to `POST /api/reason` with `{ "prompt": "..." }` and an Authorization Bearer token. This is the same protected endpoint used by the web reasoning workspace. The API verifies the token with Supabase Auth, derives the user identity server-side, and rejects anonymous, invalid, or expired sessions. The legacy `/api/agent/evolve` path is not used.

Remote API origins must use HTTPS. HTTP is accepted only for localhost/loopback development.

## Remaining mobile app work

A separate mobile-app integration is still required to add the real Supabase client, secure native session storage, sign-in/sign-out flow, navigation entry point, and platform build configuration. This repository-only PR deliberately does not invent those app-shell dependencies or claim that a native app can already mount the screen.
