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
let emergencyStop = false;
let proposalRecords: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  emergencyStop = false;
  proposalRecords = [];
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
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
        tradingEnabled: !emergencyStop,
        maxOrderNotional: 10000,
        maxPositionNotional: 25000,
        maxGrossExposure: 75000,
      }), { status: 200 });
    }
    if (url === '/api/quant/paper/risk/state') {
      return new Response(JSON.stringify({
        tradingEnabled: !emergencyStop,
        emergencyStop,
        emergencyStopReason: emergencyStop ? 'manual_emergency_stop' : null,
        maxDailyLoss: 5000,
        maxDrawdownPct: 10,
        dailyRisk: { risk_date: '2026-11-05', starting_equity: '100000', current_equity: '99999.85', daily_loss: '0.15' },
        portfolioRisk: { peak_equity: '100000', current_equity: '99999.85', max_drawdown_pct: '0.15' },
      }), { status: 200 });
    }
    if (url === '/api/quant/paper/risk/emergency-stop' && init?.method === 'POST') {
      emergencyStop = true;
      return new Response(JSON.stringify({ emergencyStop: true, tradingEnabled: false }), { status: 200 });
    }
    if (url === '/api/quant/paper/risk/emergency-stop/reset' && init?.method === 'POST') {
      emergencyStop = false;
      return new Response(JSON.stringify({ emergencyStop: false, tradingEnabled: false }), { status: 200 });
    }
    if (url === '/api/quant/paper/proposals') {
      if (init?.method === 'POST') {
        const proposal = {
          id: 'proposal-1',
          signalId: 'signal-1',
          symbol: 'SPY',
          side: 'buy',
          quantity: 1.66666666,
          referencePrice: 600,
          notional: 999.999996,
          status: 'pending',
          expiresAt: '2026-11-06T12:00:00.000Z',
          orderId: null,
          reason: null,
          strategy: 'sma_crossover',
          sourceBarDate: '2026-11-04',
        };
        proposalRecords = [proposal];
        return new Response(JSON.stringify({ proposal, orderPlaced: false }), { status: 201 });
      }
      return new Response(JSON.stringify({ proposals: proposalRecords, executionEnabled: false }), { status: 200 });
    }
    if (url === '/api/quant/paper/proposals/proposal-1/confirm' && init?.method === 'POST') {
      proposalRecords = proposalRecords.map((item) => ({
        ...item, status: 'confirmed', orderId: 'paper-order-proposal-1',
      }));
      return new Response(JSON.stringify({
        proposalId: 'proposal-1',
        status: 'confirmed',
        order: { orderId: 'paper-order-proposal-1', status: 'filled' },
        mode: 'paper_simulation_only',
        brokerConnected: false,
      }), { status: 201 });
    }
    if (url === '/api/quant/paper/proposals/proposal-1/reject' && init?.method === 'POST') {
      proposalRecords = proposalRecords.map((item) => ({
        ...item, status: 'rejected', reason: 'rejected_by_user',
      }));
      return new Response(JSON.stringify({ proposalId: 'proposal-1', status: 'rejected' }), { status: 200 });
    }
    if (url === '/api/quant/strategy-signals') {
      return new Response(JSON.stringify({
        signals: [{
          id: 'signal-1',
          symbol: 'SPY',
          strategy: 'sma_crossover',
          action: 'buy',
          referencePrice: 600,
          generatedAt: '2026-11-05T10:00:00.000Z',
          sourceBarDate: '2026-11-04',
        }],
        executionEnabled: false,
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
  vi.unstubAllGlobals();
});

describe('paper trading performance summary', () => {
  it('activates the emergency stop only after an explicit confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    await act(async () => root.render(<PaperTradingPanel />));
    await vi.waitFor(() => expect(container.textContent).toContain('Activate emergency stop'));
    const button = Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Activate emergency stop'));
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('EMERGENCY STOP ACTIVE'));
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper/risk/emergency-stop', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'manual_emergency_stop' }),
    }));
  });

  it('creates, reviews and explicitly confirms a strategy-driven paper proposal', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    await act(async () => root.render(<PaperTradingPanel />));
    await vi.waitFor(() => expect(container.textContent).toContain('Create paper order proposal'));

    const create = Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Create paper order proposal'));
    expect(create).toBeTruthy();
    await act(async () => {
      create?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Proposal created for SPY'));
    await vi.waitFor(() => expect(container.textContent).toContain('Confirm & simulate paper order'));
    expect(container.textContent).toContain('1.66666666 units');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper/proposals', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ signalId: 'signal-1', notional: 1000 }),
    }));

    const confirm = Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Confirm & simulate paper order'));
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.textContent).toContain('confirmed'));
    expect(container.textContent).toContain('paper-order-proposal-1');
    expect(api.fetch).toHaveBeenCalledWith(
      '/api/quant/paper/proposals/proposal-1/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('summarizes recorded exits and fees without calling them net portfolio return', async () => {
    await act(async () => root.render(<PaperTradingPanel />));
    await vi.waitFor(() => expect(container.textContent).toContain('Recorded performance'));

    expect(container.textContent).toContain('49.50');
    expect(container.textContent).toContain('0.15');
    expect(container.textContent).toContain('100.0%');
    expect(container.textContent).toContain('latest 50 simulated fills');
    expect(container.textContent).toContain('not total net portfolio return');
    expect(container.textContent).toContain('Recent research signals');
    expect(container.textContent).toContain('SPY · BUY');
    expect(container.textContent).toContain('600.00');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/paper/risk');
    expect(api.fetch).toHaveBeenCalledWith('/api/quant/strategy-signals');
  });
});
