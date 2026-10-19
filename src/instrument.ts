// src/instrument.ts
export {};

const sentryDsn = process.env.SENTRY_DSN;

if (sentryDsn) {
  try {
    const [Sentry, profiling] = await Promise.all([
      import('@sentry/node'),
      import('@sentry/profiling-node'),
    ]);

    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV || 'development',
      integrations: [profiling.nodeProfilingIntegration()],
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      profileSessionSampleRate: 1.0,
      profileLifecycle: 'trace',
    });
  } catch (error) {
    console.warn(
      '[Sentry] Disabled because its optional packages are unavailable:',
      error,
    );
  }
}