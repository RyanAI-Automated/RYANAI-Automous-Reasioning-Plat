export type PaperRiskLimits = {
  maxDailyLoss: number;
  maxDrawdownPct: number;
};

export type PaperRiskAssessment = {
  projectedEquity: number;
  dailyLoss: number;
  drawdownPct: number;
  peakEquityAfterOrder: number;
  breach: 'daily_loss_limit' | 'max_drawdown_limit' | null;
};

export function assessPaperOrderRisk(input: {
  cashBalance: number;
  grossExposure: number;
  heldQuantity: number;
  heldMarkPrice: number;
  orderQuantity: number;
  referencePrice: number;
  fee: number;
  side: 'buy' | 'sell';
  startingDailyEquity: number;
  lifetimePeakEquity: number;
  limits: PaperRiskLimits;
}): PaperRiskAssessment {
  const numericValues = [
    input.cashBalance, input.grossExposure, input.heldQuantity,
    input.heldMarkPrice, input.orderQuantity, input.referencePrice,
    input.fee, input.startingDailyEquity, input.lifetimePeakEquity,
    input.limits.maxDailyLoss, input.limits.maxDrawdownPct,
  ];
  if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Paper risk assessment requires finite, non-negative values.');
  }
  if (input.referencePrice <= 0 || input.orderQuantity <= 0) {
    throw new Error('Paper order quantity and reference price must be positive.');
  }
  if (input.side === 'sell' && input.heldQuantity < input.orderQuantity) {
    throw new Error('Paper sell quantity exceeds the held position.');
  }

  const nextQuantity = input.side === 'buy'
    ? input.heldQuantity + input.orderQuantity
    : input.heldQuantity - input.orderQuantity;
  const nextCash = input.side === 'buy'
    ? input.cashBalance - input.orderQuantity * input.referencePrice - input.fee
    : input.cashBalance + input.orderQuantity * input.referencePrice - input.fee;
  const currentSymbolValue = input.heldQuantity * input.heldMarkPrice;
  const projectedEquity = nextCash
    + (input.grossExposure - currentSymbolValue)
    + (nextQuantity * input.referencePrice);

  const dailyLoss = Math.max(0, input.startingDailyEquity - projectedEquity);
  const drawdownPct = input.lifetimePeakEquity > 0
    ? Math.max(0, ((input.lifetimePeakEquity - projectedEquity) / input.lifetimePeakEquity) * 100)
    : 0;
  const breach = dailyLoss >= input.limits.maxDailyLoss
    ? 'daily_loss_limit'
    : drawdownPct >= input.limits.maxDrawdownPct
      ? 'max_drawdown_limit'
      : null;

  return {
    projectedEquity,
    dailyLoss,
    drawdownPct,
    peakEquityAfterOrder: Math.max(input.lifetimePeakEquity, projectedEquity),
    breach,
  };
}
