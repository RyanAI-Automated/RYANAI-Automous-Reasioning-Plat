import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The project URL is public configuration. Keep it available when a hosting
// environment omits VITE_SUPABASE_URL; the publishable key remains an explicit
// deployment setting and is never embedded in source control.
export const DEFAULT_SUPABASE_URL = 'https://narsvpwymvlrhurqbthu.supabase.co';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

// Explicitly typed to prevent 'unknown' inference and fail closed if missing config
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
