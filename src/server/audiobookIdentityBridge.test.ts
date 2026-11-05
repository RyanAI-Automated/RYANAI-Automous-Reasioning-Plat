import { describe, expect, it, vi } from 'vitest';
import { ensureSupabaseIdentity } from './audiobookIdentityBridge.js';

const verifiedUserId = '00000000-0000-4000-8000-000000000042';

describe('Neon audiobook Supabase identity bridge', () => {
  it('upserts only the Supabase-verified immutable subject UUID', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: verifiedUserId });
    const prisma = { supabaseIdentity: { upsert } };

    await expect(
      ensureSupabaseIdentity(prisma as never, { id: verifiedUserId }),
    ).resolves.toBe(verifiedUserId);

    expect(upsert).toHaveBeenCalledExactlyOnceWith({
      where: { id: verifiedUserId },
      create: { id: verifiedUserId },
      update: {},
    });
  });

  it.each([
    '',
    'not-a-uuid',
    '00000000-0000-0000-0000-000000000042',
    '00000000-0000-4000-7000-000000000042',
  ])('rejects an invalid Supabase subject identifier before writing: %s', async (id) => {
    const upsert = vi.fn();
    const prisma = { supabaseIdentity: { upsert } };

    await expect(
      ensureSupabaseIdentity(prisma as never, { id }),
    ).rejects.toThrow('invalid user identifier');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('propagates persistence failure so the caller can fail closed', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const prisma = { supabaseIdentity: { upsert } };

    await expect(
      ensureSupabaseIdentity(prisma as never, { id: verifiedUserId }),
    ).rejects.toThrow('database unavailable');
  });
});
