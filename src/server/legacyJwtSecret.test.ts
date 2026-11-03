import { describe, expect, it } from 'vitest';
import { resolveLegacyJwtSecret } from './legacyJwtSecret.js';

describe('legacy JWT secret resolution', () => {
  it('uses an explicitly configured secret', () => {
    expect(resolveLegacyJwtSecret('production', 'a'.repeat(48))).toBe('a'.repeat(48));
  });

  it('fails closed when production has no secret', () => {
    expect(() => resolveLegacyJwtSecret('production', undefined)).toThrow(
      'JWT_SECRET is required unless NODE_ENV is explicitly development or test',
    );
  });

  it('rejects weak production secrets without echoing them', () => {
    const secret = 'weak-production-secret';
    let message = '';
    try {
      resolveLegacyJwtSecret('production', secret);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('at least 32 bytes');
    expect(message).not.toContain(secret);
  });

  it('generates non-predictable ephemeral secrets outside production', () => {
    const first = resolveLegacyJwtSecret('development', undefined);
    const second = resolveLegacyJwtSecret('test', undefined);
    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it('treats whitespace-only production secrets as missing', () => {
    expect(() => resolveLegacyJwtSecret('production', '   ')).toThrow(
      'JWT_SECRET is required',
    );
  });

  it('fails closed when the runtime environment is unspecified or staging', () => {
    expect(() => resolveLegacyJwtSecret(undefined, undefined)).toThrow(
      'NODE_ENV is explicitly development or test',
    );
    expect(() => resolveLegacyJwtSecret('staging', undefined)).toThrow(
      'NODE_ENV is explicitly development or test',
    );
  });
});
