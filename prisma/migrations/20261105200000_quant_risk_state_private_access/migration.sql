-- Daily and lifetime portfolio risk state is account-owned trading data.
-- Keep direct browser/PostgREST access disabled; the authenticated API accesses
-- these tables through the server's database connection.
DO $quant_risk_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quant_paper_daily_risk_state',
    'quant_paper_portfolio_risk_state'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$quant_risk_isolation$;
