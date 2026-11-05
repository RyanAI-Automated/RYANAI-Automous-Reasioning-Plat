import { useMemo, useState } from 'react';
import PaperTradingPanel from '@/components/quant/PaperTradingPanel';
import PaperStrategyAllocations from '@/components/quant/PaperStrategyAllocations';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import {
  BANK_CATEGORY_LABELS,
  SOUTH_AFRICAN_BANKS,
  SOUTH_AFRICAN_BANK_SOURCE,
  type SouthAfricanBankCategory,
} from '@/data/southAfricanBanks';

type TerminalTab = 'overview' | 'forex' | 'orders' | 'wallet' | 'risk';

const marketWatch = [
  { symbol: 'USD/ZAR', description: 'US Dollar / South African Rand' },
  { symbol: 'EUR/USD', description: 'Euro / US Dollar' },
  { symbol: 'GBP/USD', description: 'British Pound / US Dollar' },
  { symbol: 'XAU/USD', description: 'Gold / US Dollar' },
  { symbol: 'USD/JPY', description: 'US Dollar / Japanese Yen' },
];

const tabLabels: Record<TerminalTab, string> = {
  overview: 'Overview',
  forex: 'Forex',
  orders: 'Orders',
  wallet: 'Wallet',
  risk: 'Risk Center',
};

export default function TradingTerminalPage() {
  const [tab, setTab] = useState<TerminalTab>('overview');
  const [walletAction, setWalletAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [bankCategory, setBankCategory] = useState<SouthAfricanBankCategory | 'all'>('all');
  const [bankId, setBankId] = useState('');

  const banks = useMemo(
    () => bankCategory === 'all'
      ? SOUTH_AFRICAN_BANKS
      : SOUTH_AFRICAN_BANKS.filter((bank) => bank.category === bankCategory),
    [bankCategory],
  );

  const selectedBank = SOUTH_AFRICAN_BANKS.find((bank) => bank.id === bankId);

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI · QuantCore</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Trading Terminal</h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-400">
            Research, paper trading, risk controls and wallet workflows in one workspace.
            Live broker execution and real-money banking are intentionally disabled until an approved provider is connected.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/5 px-3 py-1.5 text-xs font-medium text-amber-200">
          <Activity className="h-3.5 w-3.5" /> Paper simulation only · no live broker
        </span>
      </header>

      <nav aria-label="Trading terminal sections" className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-2">
        {(Object.keys(tabLabels) as TerminalTab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            aria-current={tab === item ? 'page' : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tab === item ? 'bg-cyan-300 text-slate-950' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
          >
            {tabLabels[item]}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview onOpen={(next) => setTab(next)} />}
      {tab === 'forex' && <ForexWorkspace />}
      {tab === 'orders' && (
        <section className="space-y-4">
          <PaperStrategyAllocations />
          <PaperTradingPanel />
        </section>
      )}
      {tab === 'wallet' && (
        <WalletWorkspace
          walletAction={walletAction}
          onWalletAction={setWalletAction}
          bankCategory={bankCategory}
          onBankCategory={setBankCategory}
          bankId={bankId}
          onBankId={setBankId}
          banks={banks}
          selectedBank={selectedBank}
        />
      )}
      {tab === 'risk' && <RiskWorkspace />}

      {tab === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Module icon={Workflow} title="Research linked" detail="Promote completed Quant Lab experiments into the paper portfolio." />
          <Module icon={ShieldCheck} title="Risk governed" detail="Server-enforced limits protect simulated order, position and gross exposure." />
          <Module icon={BarChart3} title="QuantCore ready" detail="Research signals and backtests remain separate from execution." />
          <Module icon={BookOpen} title="Auditable" detail="Paper orders and risk decisions are persisted per authenticated account." />
        </div>
      )}
    </section>
  );
}

function Overview({ onOpen }: { onOpen: (tab: TerminalTab) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Market watch</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Forex & multi-asset workspace</h2>
          </div>
          <button type="button" onClick={() => onOpen('forex')} className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">
            Open Forex
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {marketWatch.map((market) => (
            <article key={market.symbol} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <p className="text-sm font-semibold text-white">{market.symbol}</p>
              <p className="mt-1 text-xs text-slate-500">{market.description}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-slate-400">Quote feed</span>
                <span className="rounded-full border border-amber-300/20 px-2 py-1 text-[10px] font-semibold uppercase text-amber-200">Not connected</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">QuantCore</p>
        <h2 className="mt-1 text-xl font-semibold text-white">AI trading stack</h2>
        <div className="mt-5 space-y-3">
          {[
            ['Market intelligence', 'Technical, macro and sentiment inputs'],
            ['Regime engine', 'Trend, range and volatility classification'],
            ['Signal engine', 'Research-only trade candidates'],
            ['Risk Guardian', 'Deterministic exposure and loss controls'],
            ['Execution', 'Paper ledger today; broker adapter later'],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-sm font-medium text-white">{title}</p>
              <p className="mt-1 text-xs text-slate-400">{detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ForexWorkspace() {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Forex</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Market analysis workspace</h2>
              <p className="mt-2 text-sm text-slate-400">Choose a pair for research. Live quotes are not displayed until a verified market-data provider is connected.</p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">Research mode</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {marketWatch.map((market) => (
              <div key={market.symbol} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/70 p-4">
                <div>
                  <p className="font-semibold text-white">{market.symbol}</p>
                  <p className="mt-1 text-xs text-slate-500">{market.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Signal</p>
                  <p className="mt-1 text-xs font-semibold text-amber-200">Awaiting data</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <PaperTradingPanel />
      </div>
      <RiskWorkspace compact />
    </section>
  );
}

function WalletWorkspace({
  walletAction,
  onWalletAction,
  bankCategory,
  onBankCategory,
  bankId,
  onBankId,
  banks,
  selectedBank,
}: {
  walletAction: 'deposit' | 'withdraw';
  onWalletAction: (value: 'deposit' | 'withdraw') => void;
  bankCategory: SouthAfricanBankCategory | 'all';
  onBankCategory: (value: SouthAfricanBankCategory | 'all') => void;
  bankId: string;
  onBankId: (value: string) => void;
  banks: typeof SOUTH_AFRICAN_BANKS;
  selectedBank?: (typeof SOUTH_AFRICAN_BANKS)[number];
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Wallet</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Funding & withdrawals</h2>
        <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-slate-950/70 p-2">
          <button
            type="button"
            onClick={() => onWalletAction('deposit')}
            aria-pressed={walletAction === 'deposit'}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${walletAction === 'deposit' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}
          >
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </button>
          <button
            type="button"
            onClick={() => onWalletAction('withdraw')}
            aria-pressed={walletAction === 'withdraw'}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${walletAction === 'withdraw' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}
          >
            <ArrowUpFromLine className="h-4 w-4" /> Withdraw
          </button>
        </div>
        <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
          <p className="text-sm font-semibold text-amber-100">Provider connection required</p>
          <p className="mt-1 text-xs leading-5 text-amber-200/80">
            This screen records the intended workflow only. No bank credentials, payment instruction or real-money transfer is executed by the current RyanAI paper-trading runtime.
          </p>
        </div>
      </article>

      <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">South Africa</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{walletAction === 'deposit' ? 'Deposit destination' : 'Withdrawal destination'}</h2>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">{SOUTH_AFRICAN_BANKS.length} institutions</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            Bank category
            <select value={bankCategory} onChange={(event) => onBankCategory(event.target.value as SouthAfricanBankCategory | 'all')} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="all">All South African bank institutions</option>
              {(Object.keys(BANK_CATEGORY_LABELS) as SouthAfricanBankCategory[]).map((category) => (
                <option key={category} value={category}>{BANK_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Bank
            <select value={bankId} onChange={(event) => onBankId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Choose a bank…</option>
              {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}{bank.country ? ` · ${bank.country}` : ''}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            Account holder
            <input disabled placeholder="Provider connection required" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-500" />
          </label>
          <label className="text-xs text-slate-400">
            Account / beneficiary
            <input disabled placeholder="Provider connection required" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-500" />
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <p className="text-xs text-slate-400">Selected institution</p>
          <p className="mt-1 text-sm font-semibold text-white">{selectedBank?.name ?? 'None selected'}</p>
          <p className="mt-1 text-xs text-slate-500">{selectedBank?.country ? `Foreign branch · ${selectedBank.country}` : selectedBank ? BANK_CATEGORY_LABELS[selectedBank.category] : 'Choose an institution to continue.'}</p>
        </div>

        <p className="mt-4 text-[11px] leading-5 text-slate-500">
          Bank catalogue source: {SOUTH_AFRICAN_BANK_SOURCE} Provider onboarding, account verification, payment rails and regulatory checks remain separate backend work.
        </p>

        <button type="button" disabled className="mt-4 w-full rounded-lg border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-500">
          {walletAction === 'deposit' ? 'Deposit unavailable until provider is connected' : 'Withdrawal unavailable until provider is connected'}
        </button>
      </article>
    </section>
  );
}

function RiskWorkspace({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'rounded-2xl border border-white/10 bg-slate-900/70 p-5' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4'}>
      {!compact && <RiskCard title="Mode" value="Paper simulation" detail="No live broker" />}
      <RiskCard title="Order limit" value="Server enforced" detail="Per-order cap" />
      <RiskCard title="Position limit" value="Server enforced" detail="Per-symbol cap" />
      <RiskCard title="Gross exposure" value="Server enforced" detail="Portfolio cap" />
      <RiskCard title="Emergency stop" value="Available" detail="Explicit reset required" />
      {compact && (
        <p className="mt-4 text-xs leading-5 text-slate-400">
          The risk API remains authoritative. UI controls cannot bypass server-side limits.
        </p>
      )}
    </section>
  );
}

function RiskCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <ShieldCheck className="h-5 w-5 text-cyan-300" />
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </article>
  );
}

function Module({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <Icon className="h-5 w-5 text-cyan-300" />
      <h2 className="mt-3 text-sm font-semibold text-white">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </article>
  );
}
