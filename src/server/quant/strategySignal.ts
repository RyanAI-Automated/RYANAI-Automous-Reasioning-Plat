import type { QuantBar } from './alpacaMarketData.js';

export type SmaCrossoverAction = 'buy' | 'sell' | 'hold';

export type SmaCrossoverSignal = {
  strategy: 'sma_crossover';
  action: SmaCrossoverAction;
  referencePrice: number;
  previousFastSma: number;
  previousSlowSma: number;
  fastSma: number;
  slowSma: number;
  generatedAt: string;
  sourceBarDate: string;
};

function average(values: number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Moving-average input is empty or non-finite.');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lastCloses(bars: QuantBar[], window: number, offset = 0): number[] {
  const end = bars.length - offset;
  return bars.slice(end - window, end).map((bar) => bar.close);
}

export function createSmaCrossoverSignal(
  bars: QuantBar[],
  fastWindow: number,
  slowWindow: number,
  generatedAt = new Date(),
): SmaCrossoverSignal {
  if (!Number.isInteger(fastWindow) || fastWindow < 2 || fastWindow > 50) {
    throw new Error('Fast SMA window must be between 2 and 50.');
  }
  if (!Number.isInteger(slowWindow) || slowWindow <= fastWindow || slowWindow > 200) {
    throw new Error('Slow SMA window must be greater than the fast window and no more than 200.');
  }
  if (bars.length < slowWindow + 1) {
    throw new Error(`At least ${slowWindow + 1} completed daily bars are required to validate a crossover.`);
  }

  const currentFast = average(lastCloses(bars, fastWindow));
  const currentSlow = average(lastCloses(bars, slowWindow));
  const previousFast = average(lastCloses(bars, fastWindow, 1));
  const previousSlow = average(lastCloses(bars, slowWindow, 1));

  let action: SmaCrossoverAction = 'hold';
  if (previousFast <= previousSlow && currentFast > currentSlow) action = 'buy';
  else if (previousFast >= previousSlow && currentFast < currentSlow) action = 'sell';

  const latest = bars[bars.length - 1];
  if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) {
    throw new Error('The latest completed bar has no valid close price.');
  }

  return {
    strategy: 'sma_crossover',
    action,
    referencePrice: latest.close,
    previousFastSma: previousFast,
    previousSlowSma: previousSlow,
    fastSma: currentFast,
    slowSma: currentSlow,
    generatedAt: generatedAt.toISOString(),
    sourceBarDate: latest.date,
  };
}
