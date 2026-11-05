export type BrokerOrderRequest = {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  limitPrice?: number;
  clientOrderId: string;
};

export type BrokerOrderResult =
  | { status: 'accepted' | 'rejected'; brokerOrderId?: string; reason?: string }
  | { status: 'unsupported'; reason: string };

export type BrokerAdapterMode = 'disabled' | 'sandbox' | 'live';

export type BrokerAdapterCapabilities = {
  orderPreview: boolean;
  idempotentClientOrderIds: boolean;
  fillReconciliation: boolean;
  cancelOrders: boolean;
};

export type BrokerAdapterProbeResult =
  | { status: 'disabled'; reason: string }
  | {
      status: 'sandbox_ready';
      provider: string;
      accountId: string;
      environment: 'sandbox';
      readOnly: true;
      checkedAt: string;
    }
  | { status: 'unavailable'; reason: string };

export interface BrokerAdapter {
  readonly id: string;
  readonly mode: BrokerAdapterMode;
  readonly liveTradingEnabled: boolean;
  readonly capabilities: BrokerAdapterCapabilities;
  /** Must be read-only; certification never calls placeOrder. */
  probe(): Promise<BrokerAdapterProbeResult>;
  placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
}

export class DisabledBrokerAdapter implements BrokerAdapter {
  readonly id = 'disabled';
  readonly mode = 'disabled' as const;
  readonly liveTradingEnabled = false;
  readonly capabilities: BrokerAdapterCapabilities = {
    orderPreview: false,
    idempotentClientOrderIds: false,
    fillReconciliation: false,
    cancelOrders: false,
  };

  async probe(): Promise<BrokerAdapterProbeResult> {
    return {
      status: 'disabled',
      reason: 'No broker provider is configured or approved.',
    };
  }

  async placeOrder(): Promise<BrokerOrderResult> {
    return {
      status: 'unsupported',
      reason: 'Live broker execution is disabled until an approved provider, credential scope and security gate are configured.',
    };
  }
}
