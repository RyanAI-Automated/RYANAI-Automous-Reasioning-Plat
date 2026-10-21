DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        -- Grant Read-Only (SELECT) to Anon
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon;', r.tablename);
        
        -- Grant Full CRUD to Authenticated Users
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', r.tablename);
        
        -- Grant All Privileges to Service Role
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role;', r.tablename);
        
        RAISE NOTICE 'Applied Data API grants to public.%', r.tablename;
    END LOOP;
END;
$$;
