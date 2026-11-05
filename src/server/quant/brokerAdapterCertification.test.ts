import { describe, expect, it, vi } from 'vitest';
import { certifyBrokerAdapter, type CertificationAdapter } from './brokerAdapterCertification.js';

describe('read-only broker adapter certification', () => {
  it('keeps disabled adapters explicitly uncertified and execution-blocked', async () => {
    const placeOrder = vi.fn();
    const adapter: CertificationAdapter = {
      id: 'disabled', mode: 'disabled', liveTradingEnabled: false,
      capabilities: { orderPreview: false, idempotentClientOrderIds: false, fillReconciliation: false, cancelOrders: false },
      probe: async () => ({ status: 'disabled', reason: 'not configured' }), placeOrder,
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('disabled');
    expect(report.certified).toBe(false);
    expect(report.executionAllowed).toBe(false);
    expect(report.placeOrderInvoked).toBe(false);
    expect(placeOrder).not.toHaveBeenCalled();
  });
  it('certifies a read-only sandbox contract without calling placeOrder', async () => {
    const placeOrder = vi.fn();
    const adapter: CertificationAdapter = {
      id: 'sandbox-test', mode: 'sandbox', liveTradingEnabled: false,
      capabilities: { orderPreview: true, idempotentClientOrderIds: true, fillReconciliation: true, cancelOrders: true },
      probe: async () => ({ status: 'sandbox_ready', provider: 'test', accountId: 'sandbox-account',
        environment: 'sandbox', readOnly: true, checkedAt: new Date().toISOString() }), placeOrder,
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('certified_sandbox');
    expect(report.executionAllowed).toBe(false);
    expect(placeOrder).not.toHaveBeenCalled();
  });
  it('blocks live-enabled adapters before probing or placing orders', async () => {
    const probe = vi.fn(); const placeOrder = vi.fn();
    const adapter: CertificationAdapter = {
      id: 'live-test', mode: 'live', liveTradingEnabled: true,
      capabilities: { orderPreview: true, idempotentClientOrderIds: true, fillReconciliation: true, cancelOrders: true },
      probe, placeOrder,
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('blocked');
    expect(probe).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });
  it('does not certify a sandbox adapter missing a safety capability', async () => {
    const adapter: CertificationAdapter = {
      id: 'incomplete', mode: 'sandbox', liveTradingEnabled: false,
      capabilities: { orderPreview: true, idempotentClientOrderIds: true, fillReconciliation: false, cancelOrders: true },
      probe: async () => ({ status: 'sandbox_ready', provider: 'test', accountId: 'account',
        environment: 'sandbox', readOnly: true, checkedAt: new Date().toISOString() }),
      placeOrder: async () => ({ status: 'unsupported' }),
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('incomplete');
    expect(report.checks.find((item) => item.name === 'fill_reconciliation')?.passed).toBe(false);
  });
});
