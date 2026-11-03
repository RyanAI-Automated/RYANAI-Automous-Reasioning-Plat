import { createClient } from '@supabase/supabase-js';

const OWNER_EMAIL = 'rmnganyane@gmail.com';
const OWNER_ALIAS = 'sirg';
const CONFIRMATION = 'CREATE_RYANAI_OWNER_ADMIN';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const supabaseUrl = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const password = required('RYANAI_OWNER_BOOTSTRAP_PASSWORD');
  const confirmation = required('RYANAI_OWNER_BOOTSTRAP_CONFIRM');

  if (confirmation !== CONFIRMATION) {
    throw new Error('Explicit bootstrap confirmation did not match.');
  }
  if (password.length < 16) {
    throw new Error('Use a newly generated password of at least 16 characters.');
  }
  if (!/^https:\/\//i.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL must use HTTPS.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let existingUser = null;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Unable to inspect Auth users: ${error.message}`);
    existingUser = data.users.find(
      (user) => user.email?.toLowerCase() === OWNER_EMAIL,
    ) ?? null;
    if (existingUser || data.users.length < 100) break;
  }

  const identity = {
    email: OWNER_EMAIL,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin', owner: true },
    user_metadata: {
      full_name: 'Sir G',
      preferred_title: 'Sir',
      username: OWNER_ALIAS,
      alias: OWNER_ALIAS,
    },
  };

  const result = existingUser
    ? await supabase.auth.admin.updateUserById(existingUser.id, identity)
    : await supabase.auth.admin.createUser(identity);

  if (result.error || !result.data.user) {
    throw new Error(`Owner admin provisioning failed: ${result.error?.message ?? 'No user returned'}`);
  }

  const verified = result.data.user;
  if (
    verified.email?.toLowerCase() !== OWNER_EMAIL ||
    verified.app_metadata?.role !== 'admin' ||
    verified.app_metadata?.owner !== true
  ) {
    throw new Error('Provisioning returned an identity that failed the owner/admin verification.');
  }

  console.info(
    `RyanAI owner administrator ${existingUser ? 'updated' : 'created'} and verified for ${OWNER_EMAIL} (alias: ${OWNER_ALIAS}).`,
  );
  console.info('Sign in again or refresh the session so the updated app_metadata claims are present in the JWT.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Owner admin provisioning failed.');
  process.exitCode = 1;
});
