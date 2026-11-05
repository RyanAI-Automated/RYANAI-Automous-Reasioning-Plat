import type { QuantBar } from './alpacaMarketData.js';

export type MarketRegime = 'trend' | 'range' | 'high_volatility' | 'low_volatility' | 'insufficient_data';
export type SignalAction = 'buy' | 'sell' | 'hold';

export type ModelSignal = {
  model: 'sma_trend' | 'momentum' | 'mean_reversion' | 'volatility';
  action: SignalAction;
  score: number;
  confidence: number;
  reason: string;
};

export type QuantCoreAnalysis = {
  regime: { name: MarketRegime; confidence: number; annualizedVolatilityPct: number };
  signals: ModelSignal[];
  consensus: { action: SignalAction; score: number; confidence: number };
  portfolio: {
    equity: number;
    grossExposure: number;
    netExposure: number;
    grossExposurePct: number;
    concentrationPct: number;
    cashPct: number;
  };
};

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('QuantCore received a non-finite value.');
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (!values.length) throw new Error('QuantCore requires non-empty data.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function sma(closes: number[], window: number): number {
  if (closes.length < window) throw new Error(`At least ${window} closes are required.`);
  return mean(closes.slice(-window));
}

function returns(bars: QuantBar[]): number[] {
  return bars.slice(1).map((bar, index) => {
    const previous = bars[index].close;
    return finite((bar.close - previous) / previous);
  });
}

function actionFromScore(score: number): SignalAction {
  if (score > 0.15) return 'buy';
  if (score < -0.15) return 'sell';
  return 'hold';
}

function buildSignals(bars: QuantBar[]): ModelSignal[] {
  const closes = bars.map((bar) => bar.close);
  const fast = sma(closes, 10);
  const slow = sma(closes, 30);
  const trendScore = clamp(((fast / slow) - 1) * 12, -1, 1);

  const momentumWindow = 10;
  const momentum = (closes[closes.length - 1] / closes[closes.length - 1 - momentumWindow]) - 1;
  const momentumScore = clamp(momentum * 20, -1, 1);

  const mean = sma(closes, 20);
  const dispersion = stdev(closes.slice(-20));
  const z = dispersion > 0 ? (closes.at(-1)! - mean) / dispersion : 0;
  const meanReversionScore = clamp(-z / 3, -1, 1);

  const dailyReturns = returns(bars).slice(-30);
  const vol = stdev(dailyReturns);
  const volatilityScore = clamp(((0.012 - vol) / 0.012), -1, 1);

  return [
    {
      model: 'sma_trend',
      action: actionFromScore(trendScore),
      score: trendScore,
      confidence: clamp(Math.abs(trendScore), 0, 1),
      reason: `10-day SMA is ${fast > slow ? 'above' : 'below'} the 30-day SMA.`,
    },
    {
      model: 'momentum',
      action: actionFromScore(momentumScore),
      score: momentumScore,
      confidence: clamp(Math.abs(momentumScore), 0, 1),
      reason: `${momentumWindow}-bar price momentum is ${(momentum * 100).toFixed(2)}%.`,
    },
    {
      model: 'mean_reversion',
      action: actionFromScore(meanReversionScore),
      score: meanReversionScore,
      confidence: clamp(Math.abs(meanReversionScore), 0, 1),
      reason: `Price is ${z.toFixed(2)} standard deviations from its 20-bar mean.`,
    },
    {
      model: 'volatility',
      action: volatilityScore > 0.15 ? 'buy' : volatilityScore < -0.15 ? 'sell' : 'hold',
      score: volatilityScore,
      confidence: clamp(Math.abs(volatilityScore), 0, 1),
      reason: `30-bar realized daily volatility is ${(vol * 100).toFixed(2)}%.`,
    },
  ];
}

function classifyRegime(bars: QuantBar[]): QuantCoreAnalysis['regime'] {
  if (bars.length < 35) return { name: 'insufficient_data', confidence: 0, annualizedVolatilityPct: 0 };
  const dailyReturns = returns(bars).slice(-30);
  const volatility = stdev(dailyReturns);
  const annualized = volatility * Math.sqrt(252) * 100;
  const closes = bars.map((bar) => bar.close);
  const trendStrength = Math.abs(sma(closes, 10) / sma(closes, 30) - 1);
  if (annualized >= 35) return { name: 'high_volatility', confidence: clamp(annualized / 70, 0, 1), annualizedVolatilityPct: annualized };
  if (annualized <= 10) return { name: 'low_volatility', confidence: clamp((15 - annualized) / 15, 0, 1), annualizedVolatilityPct: annualized };
  if (trendStrength >= 0.01) return { name: 'trend', confidence: clamp(trendStrength * 40, 0, 1), annualizedVolatilityPct: annualized };
  return { name: 'range', confidence: clamp(1 - trendStrength * 40, 0, 1), annualizedVolatilityPct: annualized };
}

function consensus(signals: ModelSignal[]): QuantCoreAnalysis['consensus'] {
  const score = mean(signals.map((signal) => signal.score));
  const confidence = mean(signals.map((signal) => signal.confidence));
  return { action: actionFromScore(score), score, confidence };
}

export function analyzeQuantCore(input: {
  bars: QuantBar[];
  portfolio?: { cash: number; positions: Array<{ symbol: string; marketValue: number }> };
}): QuantCoreAnalysis {
  if (!Array.isArray(input.bars) || input.bars.length < 35) {
    throw new Error('QuantCore requires at least 35 completed bars.');
  }
  if (input.bars.some((bar) => !bar || !Number.isFinite(bar.close) || bar.close <= 0)) {
    throw new Error('QuantCore bars must contain finite positive closes.');
  }

  const signals = buildSignals(input.bars);
  const portfolio = input.portfolio ?? { cash: 0, positions: [] };
  const equity = finite(portfolio.cash + portfolio.positions.reduce((sum, position) => sum + finite(position.marketValue), 0));
  if (equity <= 0) throw new Error('Portfolio equity must be positive.');
  const gross = portfolio.positions.reduce((sum, position) => sum + Math.abs(finite(position.marketValue)), 0);
  const net = portfolio.positions.reduce((sum, position) => sum + finite(position.marketValue), 0);
  const largest = portfolio.positions.reduce((max, position) => Math.max(max, Math.abs(position.marketValue)), 0);
  return {
    regime: classifyRegime(input.bars),
    signals,
    consensus: consensus(signals),
    portfolio: {
      equity,
      grossExposure: gross,
      netExposure: net,
      grossExposurePct: (gross / equity) * 100,
      concentrationPct: (largest / equity) * 100,
      cashPct: (portfolio.cash / equity) * 100,
    },
  };
}

export type RiskDecision = {
  decision: 'allow' | 'block';
  reasons: string[];
  projectedGrossExposure: number;
  projectedDailyLoss: number;
};

export function assessRiskGuardian(input: {
  equity: number;
  currentGrossExposure: number;
  projectedOrderNotional: number;
  projectedDailyLoss: number;
  maxOrderNotional: number;
  maxGrossExposure: number;
  maxDailyLoss: number;
  emergencyStop: boolean;
  tradingEnabled: boolean;
}): RiskDecision {
  const values = Object.values(input).filter((value) => typeof value === 'number') as number[];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Risk Guardian requires finite, non-negative numeric inputs.');
  }
  const reasons: string[] = [];
  if (!input.tradingEnabled) reasons.push('paper trading is disabled');
  if (input.emergencyStop) reasons.push('emergency stop is active');
  if (input.projectedOrderNotional > input.maxOrderNotional) reasons.push('order notional exceeds limit');
  if (input.currentGrossExposure + input.projectedOrderNotional > input.maxGrossExposure) reasons.push('gross exposure exceeds limit');
  if (input.projectedDailyLoss >= input.maxDailyLoss) reasons.push('daily loss limit would be breached');
  return {
    decision: reasons.length ? 'block' : 'allow',
    reasons,
    projectedGrossExposure: input.currentGrossExposure + input.projectedOrderNotional,
    projectedDailyLoss: input.projectedDailyLoss,
  };
}
