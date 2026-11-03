import { config } from 'dotenv';
import { resolveSupabaseSessionPoolerUrl } from './server/supabaseSessionPooler.js';

config({ quiet: true });

// Normalize the runtime database endpoint before the launcher imports agent
// modules that create their own PostgreSQL pools at module evaluation time.
// The password remains in the pre-existing DATABASE_URL and is never logged.
const sessionPoolerHost = process.env.SUPABASE_DB_POOLER_HOST?.trim();
if (sessionPoolerHost) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();

  if (!databaseUrl || !supabaseUrl) {
    throw new Error(
      'SUPABASE_DB_POOLER_HOST requires DATABASE_URL and SUPABASE_URL to be configured.',
    );
  }

  process.env.DATABASE_URL = resolveSupabaseSessionPoolerUrl(
    databaseUrl,
    sessionPoolerHost,
    supabaseUrl,
  );
  console.info('[database] Supabase shared session-pooler routing enabled.');
}
