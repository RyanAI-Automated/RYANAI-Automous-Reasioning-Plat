import { config } from 'dotenv';
import { resolveSupabaseSessionPoolerUrl } from './server/supabasePooler.js';

// Load deployment/local environment before any application module reads
// DATABASE_URL (including Prisma and the LangGraph Postgres checkpointer).
config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  const pooler = resolveSupabaseSessionPoolerUrl(
    process.env.DATABASE_URL,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SESSION_POOLER_HOST,
    process.env.SUPABASE_SSL_ROOT_CERT_PATH,
  );

  if (pooler.changed && pooler.databaseUrl) {
    process.env.DATABASE_URL = pooler.databaseUrl;
    const selectedEndpoint = new URL(pooler.databaseUrl);
    console.info(
      `[RyanAI] PostgreSQL transport selected: Supabase Shared Pooler Session mode at ${selectedEndpoint.hostname}:${selectedEndpoint.port || '5432'} (credentials omitted).`,
    );
  }
}
