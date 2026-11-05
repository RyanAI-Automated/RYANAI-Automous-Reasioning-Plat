-- Keep market-event data behind the authenticated API. No browser role receives direct table access.
DO $quant_market_data_events_isolation$
DECLARE
  browser_role TEXT;
BEGIN
  ALTER TABLE public.quant_market_data_events ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.quant_market_data_events FROM PUBLIC;
  REVOKE ALL ON SEQUENCE public.quant_market_data_events_id_seq FROM PUBLIC;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'quant_market_data_events', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', 'quant_market_data_events_id_seq', browser_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.quant_market_data_events TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.quant_market_data_events_id_seq TO service_role;
  END IF;
END;
$quant_market_data_events_isolation$;
