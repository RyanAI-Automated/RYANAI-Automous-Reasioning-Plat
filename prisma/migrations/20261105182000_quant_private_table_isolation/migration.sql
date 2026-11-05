-- Quant tables contain account-owned research and simulated trading data.
-- Access is through the authenticated RyanAI API; browser/PostgREST roles must not
-- read or mutate these tables directly. The server's privileged DB role remains
-- responsible for enforcing request.authUser ownership in parameterized queries.
ALTER TABLE public.quant_experiments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_experiments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_experiments TO service_role;

ALTER TABLE public.quant_paper_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_accounts TO service_role;

ALTER TABLE public.quant_paper_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_positions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_positions TO service_role;

ALTER TABLE public.quant_paper_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_orders TO service_role;

ALTER TABLE public.quant_paper_trades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_trades FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_trades TO service_role;

ALTER TABLE public.quant_paper_risk_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_risk_policies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_risk_policies TO service_role;

ALTER TABLE public.quant_paper_strategies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_paper_strategies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_paper_strategies TO service_role;

ALTER TABLE public.quant_market_data_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_market_data_imports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_market_data_imports TO service_role;

ALTER TABLE public.quant_strategy_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quant_strategy_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quant_strategy_signals TO service_role;
