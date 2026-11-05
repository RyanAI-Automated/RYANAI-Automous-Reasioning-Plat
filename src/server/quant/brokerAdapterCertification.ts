export type BrokerAdapterCertificationCheck = { name: string; passed: boolean; detail: string };
export type BrokerAdapterCertificationReport = {
  adapterId: string; mode: string;
  status: 'certified_sandbox' | 'disabled' | 'incomplete' | 'blocked';
  certified: boolean; adapterLiveTradingEnabled: boolean;
  executionAllowed: false; placeOrderInvoked: false; checkedAt: string;
  checks: BrokerAdapterCertificationCheck[];
};
export type CertificationAdapter = {
  id: string;
  mode: 'disabled' | 'sandbox' | 'live';
  liveTradingEnabled: boolean;
  capabilities: {
    orderPreview: boolean; idempotentClientOrderIds: boolean;
    fillReconciliation: boolean; cancelOrders: boolean;
  };
  probe(): Promise<
    | { status: 'disabled'; reason: string }
    | { status: 'unavailable'; reason: string }
    | { status: 'sandbox_ready'; provider: string; accountId: string; environment: 'sandbox'; readOnly: true; checkedAt: string }
  >;
  placeOrder(...args: unknown[]): Promise<unknown>;
};
function check(name: string, passed: boolean, detail: string): BrokerAdapterCertificationCheck {
  return { name, passed, detail };
}
/** Read-only certification. It never calls placeOrder, cancel, or preview methods. */
export async function certifyBrokerAdapter(adapter: CertificationAdapter): Promise<BrokerAdapterCertificationReport> {
  const checkedAt = new Date().toISOString();
  const adapterId = typeof adapter.id === 'string' ? adapter.id : '';
  const checks = [check('adapter_identity', adapterId.length > 0, adapterId ? 'Adapter identity is present.' : 'Adapter identity is missing.')];
  const safeMode = adapter.mode === 'disabled' || adapter.mode === 'sandbox';
  const executionDisabled = adapter.liveTradingEnabled === false && safeMode;
  checks.push(check('live_execution_gate', executionDisabled,
    executionDisabled ? 'Adapter declares live execution disabled.' : 'Live-enabled or unknown adapter modes are blocked.'));
  if (!adapterId || !executionDisabled) return {
    adapterId: adapterId || 'unknown', mode: String(adapter.mode ?? 'unknown'),
    status: 'blocked', certified: false, adapterLiveTradingEnabled: adapter.liveTradingEnabled === true,
    executionAllowed: false, placeOrderInvoked: false, checkedAt, checks,
  };
  let probe;
  try { probe = await adapter.probe(); }
  catch {
    checks.push(check('read_only_probe', false, 'Read-only provider probe failed; raw provider details are withheld.'));
    return { adapterId, mode: adapter.mode, status: 'incomplete', certified: false,
      adapterLiveTradingEnabled: false, executionAllowed: false, placeOrderInvoked: false, checkedAt, checks };
  }
  if (adapter.mode === 'disabled') {
    const disabled = probe.status === 'disabled';
    checks.push(check('disabled_adapter_probe', disabled,
      disabled ? 'Adapter confirms no provider is configured.' : 'Disabled adapter returned an unexpected probe state.'));
    return { adapterId, mode: adapter.mode, status: disabled ? 'disabled' : 'incomplete',
      certified: false, adapterLiveTradingEnabled: false, executionAllowed: false,
      placeOrderInvoked: false, checkedAt, checks };
  }
  const validProbe = probe.status === 'sandbox_ready' && probe.environment === 'sandbox' &&
    probe.readOnly === true && !!probe.provider.trim() && !!probe.accountId.trim() &&
    Number.isFinite(Date.parse(probe.checkedAt));
  checks.push(check('read_only_sandbox_probe', validProbe,
    validProbe ? 'Provider confirms a read-only sandbox account.' : 'A valid read-only sandbox probe is required.'));
  for (const [key, name] of [
    ['orderPreview', 'order_preview'], ['idempotentClientOrderIds', 'idempotent_client_order_ids'],
    ['fillReconciliation', 'fill_reconciliation'], ['cancelOrders', 'cancel_orders'],
  ] as const) {
    const passed = adapter.capabilities?.[key] === true;
    checks.push(check(name, passed, passed ? 'Capability is declared.' : 'Required broker safety capability is not declared.'));
  }
  const certified = checks.every((item) => item.passed);
  return { adapterId, mode: adapter.mode, status: certified ? 'certified_sandbox' : 'incomplete',
    certified, adapterLiveTradingEnabled: false, executionAllowed: false,
    placeOrderInvoked: false, checkedAt, checks };
}
