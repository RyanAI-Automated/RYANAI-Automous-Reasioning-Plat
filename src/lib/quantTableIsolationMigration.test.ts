import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../prisma/migrations/20261105182000_quant_private_table_isolation/migration.sql', import.meta.url),
  'utf8',
);

const privateRiskStateMigration = readFileSync(
  new URL('../../prisma/migrations/20261105200000_quant_risk_state_private_access/migration.sql', import.meta.url),
  'utf8',
);

const privateQuantTables = [
  'quant_experiments',
  'quant_paper_accounts',
  'quant_paper_positions',
  'quant_paper_orders',
  'quant_paper_trades',
  'quant_paper_risk_policies',
  'quant_paper_strategies',
  'quant_market_data_imports',
  'quant_strategy_signals',
];

describe('Quant account-data database isolation migration', () => {
  it('covers every account-owned research and simulated trading table', () => {
    for (const table of privateQuantTables) {
      expect(migration).toContain(`'${table}'`);
    }
  });

  it('enables RLS and removes direct browser-role privileges', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.%I FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON TABLE public.%I FROM %I');
    expect(migration).toContain("ARRAY['anon', 'authenticated']");
  });

  it('grants server-only access when the Supabase service role exists', () => {
    expect(migration).toContain("rolname = 'service_role'");
    expect(migration).toContain('GRANT ALL ON TABLE public.%I TO service_role');
  });

  it('does not assume Supabase roles exist on local PostgreSQL targets', () => {
    expect(migration).toContain('FROM pg_roles WHERE rolname = browser_role');
    expect(migration).toContain('IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'service_role\')');
  });
});


describe('Quant daily-risk-state database isolation migration', () => {
  it('protects both account-owned daily and lifetime risk state tables', () => {
    expect(privateRiskStateMigration).toContain("'quant_paper_daily_risk_state'");
    expect(privateRiskStateMigration).toContain("'quant_paper_portfolio_risk_state'");
  });

  it('enables RLS, revokes browser access and grants only the server role conditionally', () => {
    expect(privateRiskStateMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(privateRiskStateMigration).toContain('REVOKE ALL ON TABLE public.%I FROM PUBLIC');
    expect(privateRiskStateMigration).toContain("ARRAY['anon', 'authenticated']");
    expect(privateRiskStateMigration).toContain("rolname = 'service_role'");
    expect(privateRiskStateMigration).toContain('GRANT ALL ON TABLE public.%I TO service_role');
  });
});
