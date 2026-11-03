type AuthEnvironment = Record<string, string | undefined>;

export function requireJwtSecret(env: AuthEnvironment = process.env): string {
  const secret = env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 non-whitespace characters.');
  }
  return secret;
}

export function getMasterAdminCredentials(
  env: AuthEnvironment = process.env,
): { username: string; password: string } | null {
  const username = env.MASTER_ADMIN_USER;
  const password = env.MASTER_ADMIN_PASS;
  if (!username?.trim() || !password?.trim()) return null;
  return { username, password };
}
