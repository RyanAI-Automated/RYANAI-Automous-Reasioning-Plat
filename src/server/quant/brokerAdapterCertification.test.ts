import { describe, expect, it, vi } from 'vitest';
import { DisabledBrokerAdapter, type BrokerAdapter } from './brokerAdapter.js';
import { certifyBrokerAdapter } from './brokerAdapterCertification.js';

describe('broker adapter certification safety', () => {
  it('reports the disabled adapter as safe but not provider-certified', async () => {
    const adapter = new DisabledBrokerAdapter();
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('disabled');
    expect(report.certified).toBe(false);
    expect(report.executionAllowed).toBe(false);
    expect(report.placeOrderInvoked).toBe(false);
  });

  it('certifies a read-only sandbox contract without invoking placeOrder', async () => {
    const placeOrder = vi.fn().mockResolvedValue({ status: 'accepted' });
    const probe = vi.fn().mockResolvedValue({
      status: 'sandbox_ready',
      provider: 'test-provider',
      accountId: 'sandbox-account',
      environment: 'sandbox',
      readOnly: true,
      checkedAt: new Date().toISOString(),
    });
    const adapter: BrokerAdapter = {
      id: 'test-sandbox',
      mode: 'sandbox',
      liveTradingEnabled: false,
      capabilities: {
        orderPreview: true,
        idempotentClientOrderIds: true,
        fillReconciliation: true,
        cancelOrders: true,
      },
      probe,
      placeOrder,
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('certified_sandbox');
    expect(report.certified).toBe(true);
    expect(report.executionAllowed).toBe(false);
    expect(report.placeOrderInvoked).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('blocks live-enabled adapters without probing or placing an order', async () => {
    const probe = vi.fn();
    const placeOrder = vi.fn();
    const adapter = {
      id: 'live-adapter',
      mode: 'live' as const,
      liveTradingEnabled: true,
      capabilities: {
        orderPreview: true, idempotentClientOrderIds: true,
        fillReconciliation: true, cancelOrders: true,
      },
      probe,
      placeOrder,
    } as unknown as BrokerAdapter;
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('blocked');
    expect(report.certified).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('does not certify a sandbox adapter missing reconciliation guarantees', async () => {
    const adapter: BrokerAdapter = {
      id: 'incomplete-sandbox',
      mode: 'sandbox',
      liveTradingEnabled: false,
      capabilities: {
        orderPreview: true,
        idempotentClientOrderIds: true,
        fillReconciliation: false,
        cancelOrders: true,
      },
      probe: async () => ({
        status: 'sandbox_ready', provider: 'provider', accountId: 'account',
        environment: 'sandbox', readOnly: true, checkedAt: new Date().toISOString(),
      }),
      placeOrder: async () => ({ status: 'unsupported', reason: 'Not invoked by certification.' }),
    };
    const report = await certifyBrokerAdapter(adapter);
    expect(report.status).toBe('incomplete');
    expect(report.certified).toBe(false);
    expect(report.checks.find((item) => item.name === 'fill_reconciliation')?.passed).toBe(false);
  });
});
