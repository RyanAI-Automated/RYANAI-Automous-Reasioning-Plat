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

export interface BrokerAdapter {
  readonly id: string;
  readonly liveTradingEnabled: boolean;
  placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
}

export class DisabledBrokerAdapter implements BrokerAdapter {
  readonly id = 'disabled';
  readonly liveTradingEnabled = false;

  async placeOrder(): Promise<BrokerOrderResult> {
    return {
      status: 'unsupported',
      reason: 'Live broker execution is disabled until an approved provider, credential scope and security gate are configured.',
    };
  }
}
