// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: api.fetch }));

import PaperTradingPanel from './PaperTradingPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  api.fetch.mockImplementation(async (url: string) => {
    if (url === '/api/quant/paper') {
      return new Response(JSON.stringify({
        mode: 'paper_simulation_only',
        brokerConnected: false,
        risk: { maxOrderNotional: 10000, feeBps: 5, shortSelling: false },
        account: { startingCash: 100000, cash: 99899.85, marketValue: 100, equity: 99999.85 },
        positions: [{
          symbol: 'SPY', quantity: '1', average_entry_price: '100',
          last_price: '100', market_value: '100', unrealized_pnl: '0',
        }],
        trades: [
          {
            id: 'buy-1', symbol: 'SPY', side: 'buy', quantity: '1',
            price: '100', fee: '0.10', realized_pnl: null,
            created_at: '2026-11-05T10:00:00.000Z',
          },
          {
            id: 'sell-1', symbol: 'SPY', side: 'sell', quantity: '1',
            price: '150', fee: '0.05', realized_pnl: '49.50',
            created_at: '2026-11-05T11:00:00.000Z',
          },
        ],
      }), { status: 200 });
    }
    if (url === '/api/quant/paper/risk') {
      return new Response(JSON.stringify({
        tradingEnabled: true,
        maxOrderNotional: 10000,
        maxPositionNotional: 25000,
        maxGrossExposure: 75000,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Unexpected request.' }), { status: 404 });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('paper trading performance summary', () => {
  it('summarizes recorded exits and fees without calling them net portfolio return', async () => {
    await act(async () => root.render(<PaperTradingPanel />));
    await vi.waitFor(() => expect(container.textContent).toContain('Recorded performance'));

    expect(container.textContent).toContain('49.50');
    expect(container.textContent).toContain('0.15');
    expect(container.textContent).toContain('100.0%');
    expect(container.textContent).toContain('latest 50 simulated fills');
    expect(container.textContent).toContain('not total net portfolio return');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper/risk');
  });
});
