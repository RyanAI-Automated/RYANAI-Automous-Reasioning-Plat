import type { BrokerAdapter, BrokerAdapterProbeResult } from './brokerAdapter.js';

export type BrokerAdapterCertificationCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type BrokerAdapterCertificationReport = {
  adapterId: string;
  mode: string;
  status: 'certified_sandbox' | 'disabled' | 'incomplete' | 'blocked';
  certified: boolean;
  adapterLiveTradingEnabled: boolean;
  executionAllowed: false;
  placeOrderInvoked: false;
  checkedAt: string;
  checks: BrokerAdapterCertificationCheck[];
};

function check(name: string, passed: boolean, detail: string): BrokerAdapterCertificationCheck {
  return { name, passed, detail };
}

/**
 * Certifies read-only sandbox readiness only. It deliberately never invokes
 * placeOrder, cancel, or any state-changing broker operation.
 */
export async function certifyBrokerAdapter(adapter: BrokerAdapter): Promise<BrokerAdapterCertificationReport> {
  const checkedAt = new Date().toISOString();
  const checks: BrokerAdapterCertificationCheck[] = [];
  const adapterId = typeof adapter.id === 'string' ? adapter.id : '';
  checks.push(check('adapter_identity', adapterId.length > 0, adapterId ? 'Adapter identity is present.' : 'Adapter identity is missing.'));
  const safeMode = adapter.mode === 'disabled' || adapter.mode === 'sandbox';
  const executionDisabled = adapter.liveTradingEnabled === false && safeMode;
  checks.push(check(
    'live_execution_gate',
    executionDisabled,
    executionDisabled
      ? 'Adapter declares live execution disabled.'
      : 'Certification refuses live-enabled or unknown adapter modes.',
  ));

  if (!adapterId || !executionDisabled) {
    return {
      adapterId: adapterId || 'unknown',
      mode: String(adapter.mode ?? 'unknown'),
      status: 'blocked',
      certified: false,
      adapterLiveTradingEnabled: adapter.liveTradingEnabled === true,
      executionAllowed: false,
      placeOrderInvoked: false,
      checkedAt,
      checks,
    };
  }

  let probe: BrokerAdapterProbeResult;
  try {
    probe = await adapter.probe();
  } catch {
    checks.push(check('read_only_probe', false, 'Read-only provider probe failed; raw provider details are withheld.'));
    return {
      adapterId,
      mode: adapter.mode,
      status: 'incomplete',
      certified: false,
      adapterLiveTradingEnabled: false,
      executionAllowed: false,
      placeOrderInvoked: false,
      checkedAt,
      checks,
    };
  }

  if (adapter.mode === 'disabled') {
    const disabled = probe.status === 'disabled';
    checks.push(check(
      'disabled_adapter_probe',
      disabled,
      disabled ? 'Adapter confirms no provider is configured.' : 'Disabled adapter returned an unexpected probe state.',
    ));
    return {
      adapterId,
      mode: adapter.mode,
      status: disabled ? 'disabled' : 'incomplete',
      certified: false,
      adapterLiveTradingEnabled: false,
      executionAllowed: false,
      placeOrderInvoked: false,
      checkedAt,
      checks,
    };
  }

  const sandboxProbe = probe.status === 'sandbox_ready' &&
    probe.environment === 'sandbox' &&
    probe.readOnly === true &&
    typeof probe.provider === 'string' && probe.provider.trim().length > 0 &&
    typeof probe.accountId === 'string' && probe.accountId.trim().length > 0 &&
    Number.isFinite(Date.parse(probe.checkedAt));
  checks.push(check(
    'read_only_sandbox_probe',
    sandboxProbe,
    sandboxProbe ? 'Provider confirms a read-only sandbox account.' : 'A valid read-only sandbox probe is required.',
  ));

  const capabilities = adapter.capabilities;
  const capabilityChecks: Array<[keyof typeof capabilities, string]> = [
    ['orderPreview', 'order_preview'],
    ['idempotentClientOrderIds', 'idempotent_client_order_ids'],
    ['fillReconciliation', 'fill_reconciliation'],
    ['cancelOrders', 'cancel_orders'],
  ];
  for (const [key, name] of capabilityChecks) {
    checks.push(check(
      name,
      capabilities?.[key] === true,
      capabilities?.[key] === true ? 'Capability is declared.' : 'Required broker safety capability is not declared.',
    ));
  }

  const certified = checks.every((item) => item.passed);
  return {
    adapterId,
    mode: adapter.mode,
    status: certified ? 'certified_sandbox' : 'incomplete',
    certified,
    adapterLiveTradingEnabled: false,
    executionAllowed: false,
    placeOrderInvoked: false,
    checkedAt,
    checks,
  };
}
