-- Quant tables contain account-owned research and simulated trading data.
-- Access is through the authenticated RyanAI API; browser/PostgREST roles must not
-- read or mutate these tables directly. Request-level ownership remains enforced
-- by parameterized server queries. Keep this migration portable to local Postgres
-- where the Supabase-specific roles may not exist.
DO $quant_isolation$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quant_experiments',
    'quant_paper_accounts',
    'quant_paper_positions',
    'quant_paper_orders',
    'quant_paper_trades',
    'quant_paper_risk_policies',
    'quant_paper_strategies',
    'quant_market_data_imports',
    'quant_strategy_signals'
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
$quant_isolation$;
