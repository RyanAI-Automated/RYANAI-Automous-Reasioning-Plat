import { describe, expect, it } from 'vitest';
import { assertLegacyEntrypointEnvironment } from './legacyEntrypointGuard.js';

describe('legacy API entrypoint environment guard', () => {
  it.each(['development', 'test'])('allows explicit %s use', (environment) => {
    expect(() => assertLegacyEntrypointEnvironment(environment)).not.toThrow();
  });

  it.each([undefined, 'production', 'staging', 'preview', ''])(
    'rejects unsupported environment %s',
    (environment) => {
      expect(() => assertLegacyEntrypointEnvironment(environment)).toThrow(
        'restricted to NODE_ENV=development or test',
      );
    },
  );
});
