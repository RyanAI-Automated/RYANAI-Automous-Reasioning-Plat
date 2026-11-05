export type PortfolioAssetHistory = {
  symbol: string;
  bars: Array<{ date: string; close: number }>;
};

export type PortfolioOptimizationInput = {
  assets: PortfolioAssetHistory[];
  investedWeight?: number;
  maxWeight?: number;
  maxTurnoverPct?: number;
  transactionCostBps?: number;
  riskFreeRatePct?: number;
  currentWeights?: Record<string, number>;
};

export type PortfolioOptimizationResult = {
  method: 'projected_gradient_minimum_variance';
  observations: number;
  period: { start: string; end: string; sessions: number };
  weights: Array<{ symbol: string; weight: number; weightPct: number }>;
  cashWeight: number;
  metrics: {
    expectedAnnualReturnPct: number;
    annualizedVolatilityPct: number;
    sharpeRatio: number;
    estimatedOneWayTurnoverPct: number;
    estimatedTransactionCostPct: number;
  };
  constraints: {
    longOnly: true;
    leverage: false;
    investedWeight: number;
    maxWeight: number;
    maxTurnoverPct: number;
    turnoverConstraintApplied: boolean;
    allSatisfied: true;
  };
  solver: { iterations: number; converged: boolean; shrinkage: number };
  executionMode: 'research_allocation_only';
  ordersCreated: false;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function projectCappedSimplex(values: number[], total: number, cap: number): number[] {
  if (values.length * cap + 1e-10 < total) throw new Error('Maximum asset weight makes the allocation infeasible.');
  let low = Math.min(...values.map((value) => value - cap));
  let high = Math.max(...values);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const threshold = (low + high) / 2;
    const sum = values.reduce((value, item) => value + Math.min(cap, Math.max(0, item - threshold)), 0);
    if (sum > total) low = threshold;
    else high = threshold;
  }
  const threshold = (low + high) / 2;
  const projected = values.map((value) => Math.min(cap, Math.max(0, value - threshold)));
  let residual = total - projected.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < projected.length && Math.abs(residual) > 1e-10; index += 1) {
    const room = residual > 0 ? cap - projected[index] : projected[index];
    const adjustment = Math.sign(residual) * Math.min(Math.abs(residual), room);
    projected[index] += adjustment;
    residual -= adjustment;
  }
  if (Math.abs(residual) > 1e-7) throw new Error('Portfolio constraints could not be satisfied numerically.');
  return projected;
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Long-only minimum-variance allocation using aligned daily close returns.
 * Estimates are historical, in-sample, and never create or submit orders.
 */
export function optimizeLongOnlyPortfolio(input: PortfolioOptimizationInput): PortfolioOptimizationResult {
  if (!Array.isArray(input.assets) || input.assets.length < 2 || input.assets.length > 20) {
    throw new Error('Portfolio optimization requires between 2 and 20 assets.');
  }
  const symbols = input.assets.map((asset) => asset.symbol.trim().toUpperCase());
  if (symbols.some((symbol) => !/^[A-Z0-9.-]{1,15}$/.test(symbol)) || new Set(symbols).size !== symbols.length) {
    throw new Error('Portfolio symbols must be unique valid tickers.');
  }
  const dates = input.assets[0].bars.map((bar) => bar.date);
  if (dates.length < 31 || dates.length > 2500) {
    throw new Error('Each asset must contain between 31 and 2500 aligned daily bars.');
  }
  for (let assetIndex = 0; assetIndex < input.assets.length; assetIndex += 1) {
    const bars = input.assets[assetIndex].bars;
    if (!Array.isArray(bars) || bars.length !== dates.length) {
      throw new Error('All assets must have the same number of daily bars.');
    }
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || bar.date !== dates[index] ||
          !finite(bar.close) || bar.close <= 0 ||
          (index > 0 && bar.date <= bars[index - 1].date)) {
        throw new Error('Asset histories must have aligned dates and finite positive closes.');
      }
    }
  }

  const investedWeight = input.investedWeight ?? 0.95;
  const maxWeight = input.maxWeight ?? 0.5;
  const maxTurnoverPct = input.maxTurnoverPct ?? 100;
  const transactionCostBps = input.transactionCostBps ?? 10;
  const riskFreeRatePct = input.riskFreeRatePct ?? 0;
  if (!finite(investedWeight) || investedWeight <= 0 || investedWeight > 1) {
    throw new Error('investedWeight must be greater than 0 and no more than 1.');
  }
  if (!finite(maxWeight) || maxWeight <= 0 || maxWeight > 1 ||
      maxWeight * input.assets.length + 1e-10 < investedWeight) {
    throw new Error('maxWeight is infeasible for the requested investedWeight and asset count.');
  }
  if (!finite(maxTurnoverPct) || maxTurnoverPct < 0 || maxTurnoverPct > 100) {
    throw new Error('maxTurnoverPct must be between 0 and 100.');
  }
  if (!finite(transactionCostBps) || transactionCostBps < 0 || transactionCostBps > 1000) {
    throw new Error('transactionCostBps must be between 0 and 1000.');
  }
  if (!finite(riskFreeRatePct) || riskFreeRatePct < 0 || riskFreeRatePct > 100) {
    throw new Error('riskFreeRatePct must be between 0 and 100.');
  }

  const assetCount = input.assets.length;
  const sessionCount = dates.length - 1;
  const returns = Array.from({ length: sessionCount }, (_, row) =>
    input.assets.map((asset) => asset.bars[row + 1].close / asset.bars[row].close - 1),
  );
  if (returns.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error('Daily returns contain invalid values.');
  }
  const means = Array.from({ length: assetCount }, (_, column) =>
    returns.reduce((sum, row) => sum + row[column], 0) / sessionCount,
  );
  const covariance = Array.from({ length: assetCount }, (_, left) =>
    Array.from({ length: assetCount }, (_, right) => {
      let sum = 0;
      for (const row of returns) sum += (row[left] - means[left]) * (row[right] - means[right]);
      return sum / (sessionCount - 1);
    }),
  );

  const shrinkage = 0.1;
  const stableCovariance = covariance.map((row, left) => row.map((value, right) =>
    left === right ? value + 1e-10 : value * (1 - shrinkage),
  ));
  const lipschitz = 2 * Math.max(...stableCovariance.map((row) =>
    row.reduce((sum, value) => sum + Math.abs(value), 0),
  ));
  const step = lipschitz > 1e-12 ? 1 / lipschitz : 1;
  let weights = Array(assetCount).fill(investedWeight / assetCount) as number[];
  let converged = false;
  let iterations = 0;
  for (iterations = 1; iterations <= 2000; iterations += 1) {
    const gradient = stableCovariance.map((row) =>
      2 * row.reduce((sum, value, column) => sum + value * weights[column], 0),
    );
    const next = projectCappedSimplex(weights.map((weight, index) => weight - step * gradient[index]), investedWeight, maxWeight);
    const difference = Math.max(...next.map((weight, index) => Math.abs(weight - weights[index])));
    weights = next;
    if (difference < 1e-10) {
      converged = true;
      break;
    }
  }

  let turnover = investedWeight;
  let turnoverConstraintApplied = false;
  if (input.currentWeights !== undefined) {
    const unknown = Object.keys(input.currentWeights).filter((symbol) => !symbols.includes(symbol.toUpperCase()));
    if (unknown.length) throw new Error('currentWeights contains symbols outside the selected asset universe.');
    const current = symbols.map((symbol) => input.currentWeights?.[symbol] ?? input.currentWeights?.[symbol.toLowerCase()] ?? 0);
    if (current.some((value) => !finite(value) || value < 0 || value > maxWeight) ||
        Math.abs(current.reduce((sum, value) => sum + value, 0) - investedWeight) > 1e-6) {
      throw new Error('currentWeights must be long-only, respect maxWeight, and sum to investedWeight.');
    }
    const desiredTurnover = current.reduce((sum, value, index) => sum + Math.abs(weights[index] - value), 0) / 2;
    const allowedTurnover = maxTurnoverPct / 100;
    if (desiredTurnover > allowedTurnover + 1e-10) {
      const blend = desiredTurnover > 0 ? allowedTurnover / desiredTurnover : 1;
      weights = weights.map((weight, index) => current[index] + blend * (weight - current[index]));
      turnoverConstraintApplied = true;
    }
    turnover = current.reduce((sum, value, index) => sum + Math.abs(weights[index] - value), 0) / 2;
  } else if (investedWeight * 100 > maxTurnoverPct + 1e-10) {
    throw new Error('maxTurnoverPct is too small for a cash-to-portfolio allocation without currentWeights.');
  }

  const variance = weights.reduce((sum, leftWeight, left) =>
    sum + weights.reduce((inner, rightWeight, right) => inner + leftWeight * rightWeight * covariance[left][right], 0), 0);
  const annualizedVolatility = Math.sqrt(Math.max(0, variance * 252)) * 100;
  const expectedAnnualReturn = weights.reduce((sum, weight, index) => sum + weight * means[index], 0) * 252 * 100;
  const sharpe = annualizedVolatility > 1e-12
    ? (expectedAnnualReturn - riskFreeRatePct) / annualizedVolatility
    : 0;
  const estimatedTransactionCostPct = turnover * transactionCostBps / 10000 * 100;
  return {
    method: 'projected_gradient_minimum_variance',
    observations: sessionCount,
    period: { start: dates[0], end: dates[dates.length - 1], sessions: sessionCount },
    weights: symbols.map((symbol, index) => ({
      symbol,
      weight: round(weights[index]),
      weightPct: round(weights[index] * 100, 4),
    })),
    cashWeight: round(1 - weights.reduce((sum, value) => sum + value, 0)),
    metrics: {
      expectedAnnualReturnPct: round(expectedAnnualReturn, 4),
      annualizedVolatilityPct: round(annualizedVolatility, 4),
      sharpeRatio: round(sharpe, 4),
      estimatedOneWayTurnoverPct: round(turnover * 100, 4),
      estimatedTransactionCostPct: round(estimatedTransactionCostPct, 6),
    },
    constraints: {
      longOnly: true,
      leverage: false,
      investedWeight: round(investedWeight),
      maxWeight: round(maxWeight),
      maxTurnoverPct: round(maxTurnoverPct, 4),
      turnoverConstraintApplied,
      allSatisfied: true,
    },
    solver: { iterations: Math.min(iterations, 2000), converged, shrinkage },
    executionMode: 'research_allocation_only',
    ordersCreated: false,
  };
}
