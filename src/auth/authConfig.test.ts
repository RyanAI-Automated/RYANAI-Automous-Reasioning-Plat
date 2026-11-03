import { describe, expect, it } from 'vitest';
import { getMasterAdminCredentials, requireJwtSecret } from './authConfig.js';

describe('authentication configuration', () => {
  it('rejects a missing JWT signing secret', () => {
    expect(() => requireJwtSecret({})).toThrow(/JWT_SECRET must be configured/);
  });

  it('rejects a short or whitespace-only JWT signing secret', () => {
    expect(() => requireJwtSecret({ JWT_SECRET: 'short' })).toThrow();
    expect(() => requireJwtSecret({ JWT_SECRET: ' '.repeat(40) })).toThrow();
  });

  it('accepts a sufficiently long configured JWT signing secret', () => {
    expect(requireJwtSecret({ JWT_SECRET: 'x'.repeat(48) })).toBe('x'.repeat(48));
  });

  it('does not invent master administrator credentials when configuration is absent', () => {
    expect(getMasterAdminCredentials({})).toBeNull();
    expect(getMasterAdminCredentials({ MASTER_ADMIN_USER: 'admin' })).toBeNull();
    expect(getMasterAdminCredentials({ MASTER_ADMIN_PASS: 'password' })).toBeNull();
  });

  it('returns only explicitly configured master administrator credentials', () => {
    expect(getMasterAdminCredentials({
      MASTER_ADMIN_USER: 'root-operator',
      MASTER_ADMIN_PASS: 'configured-secret',
    })).toEqual({ username: 'root-operator', password: 'configured-secret' });
  });
});
