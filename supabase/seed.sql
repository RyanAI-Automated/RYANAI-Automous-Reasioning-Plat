-- ==============================================================================
-- 1. Helper Function for Standard Supabase API Access
-- ==============================================================================
CREATE OR REPLACE PROCEDURE grant_public_table_access(target_table text)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Grant read-only access to unauthenticated / public users
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon;', target_table);

    -- Grant full CRUD access to authenticated users
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', target_table);

    -- Grant full administrative access to service role
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role;', target_table);
END;
$$;


-- ==============================================================================
-- 2. Standard Pattern for New Table Migrations
-- ==============================================================================
-- Example: Creating a new table
CREATE TABLE IF NOT EXISTS public.example_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL
);

-- Apply explicit Data API grants (Method A: Direct SQL)
GRANT SELECT ON public.example_table TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.example_table TO authenticated;
GRANT ALL PRIVILEGES ON public.example_table TO service_role;

-- OR (Method B: Using the helper procedure created above)
-- CALL grant_public_table_access('example_table');
