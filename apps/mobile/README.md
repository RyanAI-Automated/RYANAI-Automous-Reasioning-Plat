# RyanAI Mobile

Standalone Expo / React Native shell for Android and iOS. It provides email/password Supabase Auth, protected navigation, SecureStore-backed session persistence, and mounts the shared authenticated Agent Console.

## Requirements
- Node.js 22.13+ for Expo SDK 58. The repository backend toolchain remains separately pinned to Node 24.
- Android Studio + Android SDK for Android builds.
- macOS + Xcode for iOS builds.
- Supabase email/password Auth enabled and RyanAI's protected `POST /api/reason` endpoint reachable over HTTPS.

## Setup
1. Copy `.env.example` to `.env`.
2. Set the Supabase URL and **publishable** key. Never put a service-role/secret key in this app.
3. Set `EXPO_PUBLIC_RYAN_API_URL` to the RyanAI API origin.
4. From this directory run `npm install`, `npm run typecheck`, `npx expo-doctor`, then `npm run start`.
5. Use `npm run android` for Android. Use `npm run ios` on macOS with Xcode for iOS.

## Security
- Anonymous sessions are not accepted for the reasoning route.
- Session tokens are resolved when the request is submitted; the Agent Console does not persist tokens.
- Supabase Auth persists sessions through Expo SecureStore. Large values are chunked into bounded secure items.
- Only the public/publishable Supabase key is exposed in the app. Backend authorization remains authoritative.

## Verification status
This PR adds the app source and native configuration. It does not claim a device build, Expo Doctor result, live sign-in, or production API verification. Generate and commit the app-local lockfile and run emulator/simulator plus authenticated integration tests before release.
