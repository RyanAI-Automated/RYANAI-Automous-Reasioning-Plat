export type PortfolioAnalytics = {
  equity: number;
  grossExposure: number;
  netExposure: number;
  cash: number;
  cashPct: number;
  grossExposurePct: number;
  largestPositionPct: number;
  positionCount: number;
};

export function calculatePortfolioAnalytics(input: {
  cash: number;
  positions: Array<{ marketValue: number }>;
}): PortfolioAnalytics {
  const numbers = [input.cash, ...input.positions.map((position) => position.marketValue)];
  if (numbers.some((value) => !Number.isFinite(value))) throw new Error('Portfolio analytics requires finite values.');
  const equity = input.cash + input.positions.reduce((sum, position) => sum + position.marketValue, 0);
  if (equity <= 0) throw new Error('Portfolio equity must be positive.');
  const grossExposure = input.positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const netExposure = input.positions.reduce((sum, position) => sum + position.marketValue, 0);
  const largestPosition = input.positions.reduce((max, position) => Math.max(max, Math.abs(position.marketValue)), 0);
  return {
    equity,
    grossExposure,
    netExposure,
    cash: input.cash,
    cashPct: (input.cash / equity) * 100,
    grossExposurePct: (grossExposure / equity) * 100,
    largestPositionPct: (largestPosition / equity) * 100,
    positionCount: input.positions.length,
  };
}
