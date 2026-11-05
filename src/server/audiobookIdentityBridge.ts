import type { PrismaClient } from '../generated/audiobook-prisma/index.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type IdentityStore = Pick<PrismaClient, 'supabaseIdentity'>;

/**
 * Create the minimum Neon-side ownership anchor for an identity already verified
 * by the Supabase Auth server in requireUser(). Never pass browser claims or a
 * decoded, unverified JWT to this function.
 *
 * The Neon record contains only the immutable Supabase subject UUID. It does not
 * copy email, user metadata, roles, password hashes, sessions, or tokens.
 */
export async function ensureSupabaseIdentity(
  prisma: IdentityStore,
  verifiedSupabaseUser: { id: string },
): Promise<string> {
  const id = verifiedSupabaseUser.id;
  if (!UUID.test(id)) {
    throw new Error('Supabase returned an invalid user identifier.');
  }

  await prisma.supabaseIdentity.upsert({
    where: { id },
    create: { id },
    update: {},
  });

  return id;
}
