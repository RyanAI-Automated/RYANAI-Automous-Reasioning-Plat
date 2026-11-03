import { describe, expect, it } from 'vitest';
import { containsTaskCommentSecretMaterial } from './taskCommentSecurity.js';

describe('task comment credential screening', () => {
  it.each([
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    'nvapi-abcdefghijklmnopqrstuvwxyz123456',
    '-----BEGIN PRIVATE KEY-----',
    'DATABASE_' + 'URL=placeholder-value',
    'SUPABASE_SERVICE_ROLE_KEY=super-secret-value',
  ])('rejects likely credential material: %s', (value) => {
    expect(containsTaskCommentSecretMaterial(value)).toBe(true);
  });

  it.each([
    'The API returned a 503 and I am investigating.',
    'Please review the deployment workflow before merge.',
    'The DATABASE_URL variable is required in production.',
    'The prefix sk- is used by some API credentials.',
  ])('allows ordinary progress text: %s', (value) => {
    expect(containsTaskCommentSecretMaterial(value)).toBe(false);
  });
});
