// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: api.fetch }));

import QuantLabPage from './QuantLab';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const marketImport = {
  id: 'market-import-1',
  symbol: 'SPY',
  provider: 'alpaca',
  feed: 'iex',
  timeframe: '1Day',
  bar_count: 250,
  last_bar_at: '2026-11-04T23:59:59.999Z',
  fetched_at: '2026-11-05T12:00:00.000Z',
  is_stale: false,
  provenance: { coverageNote: 'IEX is a single exchange feed.' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/quant/experiments') {
      return new Response(JSON.stringify({ experiments: [] }), { status: 200 });
    }
    if (url === '/api/quant/market-data/imports') {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ import: marketImport }), { status: 201 });
      }
      return new Response(JSON.stringify({ imports: [] }), { status: 200 });
    }
    if (url === '/api/quant/strategy-signals') {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          signal: {
            id: 'signal-1', importId: marketImport.id, symbol: 'SPY',
            strategy: 'sma_crossover', action: 'buy', referencePrice: 600,
            previousFastSma: 598, previousSlowSma: 599,
            fastSma: 601, slowSma: 599.5,
            generatedAt: '2026-11-05T12:00:00.000Z', sourceBarDate: '2026-11-04',
          },
          executionEnabled: false,
          message: 'Signal saved for research. No paper order was created.',
        }), { status: 201 });
      }
      return new Response(JSON.stringify({ signals: [], executionEnabled: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Unexpected API request.' }), { status: 404 });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.includes(label));
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Quant Lab market data workflow', () => {
  it('imports a dataset, selects it and generates a research-only signal', async () => {
    await act(async () => root.render(<QuantLabPage />));
    await vi.waitFor(() => expect(container.textContent).toContain('Market data'));

    await clickButton('Import 250 daily bars');
    await vi.waitFor(() => expect(container.textContent).toContain('Imported 250 completed daily bars'));
    const selector = container.querySelector('select') as HTMLSelectElement;
    expect(selector.value).toBe(marketImport.id);

    await clickButton('Generate SMA crossover signal');
    await vi.waitFor(() => expect(container.textContent).toContain('SPY · sma crossover'));
    expect(container.textContent).toContain('buy');
    expect(container.textContent).toContain('No order was created, scheduled or executed.');

    expect(api.fetch).toHaveBeenCalledWith('/api/quant/market-data/imports', expect.objectContaining({
      method: 'POST',
    }));
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/strategy-signals', expect.objectContaining({
      method: 'POST',
    }));
  });
});
