export type PaperFillLedgerEntry = {
  id: string;
  clientFillId: string;
  quantity: number;
  price: number;
  fee: number;
};

export type PaperOrderLedgerSnapshot = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  quantity: number;
  storedFilledQuantity: number;
  storedRemainingQuantity: number;
  storedAverageFillPrice: number | null;
  storedFillPrice: number;
  storedFee: number;
  fills: PaperFillLedgerEntry[];
};

export type PaperOrderReconciliation = {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  consistent: boolean;
  orderedQuantity: number;
  ledgerFilledQuantity: number;
  remainingQuantity: number;
  averageFillPrice: number | null;
  ledgerFee: number;
  fillCount: number;
  discrepancyReasons: string[];
};

const QUANTITY_TOLERANCE = 1e-8;
const MONEY_TOLERANCE = 1e-6;

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function closeEnough(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

/** Read-only reconciliation of an order's denormalized state against its fill ledger. */
export function reconcilePaperOrder(snapshot: PaperOrderLedgerSnapshot): PaperOrderReconciliation {
  const reasons: string[] = [];
  if (!snapshot.id || !snapshot.symbol || !['buy', 'sell'].includes(snapshot.side) ||
      !Array.isArray(snapshot.fills)) {
    throw new Error('Paper order identity, side, or fill list is invalid.');
  }
  const orderValues = [
    snapshot.quantity,
    snapshot.storedFilledQuantity,
    snapshot.storedRemainingQuantity,
    snapshot.storedFillPrice,
    snapshot.storedFee,
  ];
  if (orderValues.some((value) => !finiteNonNegative(value)) || snapshot.quantity <= 0 ||
      snapshot.storedFillPrice <= 0 || snapshot.storedAverageFillPrice !== null &&
      (!Number.isFinite(snapshot.storedAverageFillPrice) || snapshot.storedAverageFillPrice <= 0)) {
    throw new Error('Paper order values must be finite and non-negative.');
  }

  const fillIds = new Set<string>();
  const validFills: PaperFillLedgerEntry[] = [];
  for (const fill of snapshot.fills) {
    if (!fill.id || !fill.clientFillId || !finiteNonNegative(fill.quantity) ||
        !finiteNonNegative(fill.price) || !finiteNonNegative(fill.fee) ||
        fill.price <= 0 || fill.quantity <= 0) {
      reasons.push('invalid_fill_record');
      continue;
    }
    if (fillIds.has(fill.clientFillId)) reasons.push('duplicate_client_fill_id');
    fillIds.add(fill.clientFillId);
    validFills.push(fill);
  }

  const ledgerFilledQuantity = validFills.reduce((sum, fill) => sum + fill.quantity, 0);
  const ledgerFee = validFills.reduce((sum, fill) => sum + fill.fee, 0);
  const totalNotional = validFills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
  const averageFillPrice = ledgerFilledQuantity > 0 ? totalNotional / ledgerFilledQuantity : null;
  const remainingQuantity = snapshot.quantity - ledgerFilledQuantity;

  if (remainingQuantity < -QUANTITY_TOLERANCE) reasons.push('overfilled_quantity');
  if (!closeEnough(snapshot.storedFilledQuantity, ledgerFilledQuantity, QUANTITY_TOLERANCE)) {
    reasons.push('stored_filled_quantity_mismatch');
  }
  if (!closeEnough(snapshot.storedRemainingQuantity, Math.max(0, remainingQuantity), QUANTITY_TOLERANCE)) {
    reasons.push('stored_remaining_quantity_mismatch');
  }
  if (!closeEnough(snapshot.storedFee, ledgerFee, MONEY_TOLERANCE)) reasons.push('stored_fee_mismatch');
  if (averageFillPrice !== null) {
    if (snapshot.storedAverageFillPrice === null ||
        !closeEnough(snapshot.storedAverageFillPrice, averageFillPrice, MONEY_TOLERANCE) ||
        !closeEnough(snapshot.storedFillPrice, averageFillPrice, MONEY_TOLERANCE)) {
      reasons.push('average_fill_price_mismatch');
    }
  } else if (snapshot.storedAverageFillPrice !== null) {
    reasons.push('unexpected_average_fill_price');
  }

  const fullyFilled = closeEnough(ledgerFilledQuantity, snapshot.quantity, QUANTITY_TOLERANCE);
  if (snapshot.status === 'filled' && !fullyFilled) reasons.push('filled_status_without_full_quantity');
  if (snapshot.status === 'partially_filled' &&
      !(ledgerFilledQuantity > QUANTITY_TOLERANCE && remainingQuantity > QUANTITY_TOLERANCE)) {
    reasons.push('partial_status_quantity_mismatch');
  }
  if (snapshot.status === 'accepted' && ledgerFilledQuantity > QUANTITY_TOLERANCE) {
    reasons.push('accepted_status_with_fills');
  }
  if (snapshot.status === 'cancelled' && remainingQuantity <= QUANTITY_TOLERANCE) {
    reasons.push('cancelled_status_without_remaining_quantity');
  }
  if (snapshot.status === 'rejected' && ledgerFilledQuantity > QUANTITY_TOLERANCE) {
    reasons.push('rejected_status_with_fills');
  }
  if (!['accepted', 'partially_filled', 'filled', 'cancelled', 'rejected'].includes(snapshot.status)) {
    reasons.push('unknown_order_status');
  }

  return {
    orderId: snapshot.id,
    symbol: snapshot.symbol,
    side: snapshot.side,
    status: snapshot.status,
    consistent: reasons.length === 0,
    orderedQuantity: snapshot.quantity,
    ledgerFilledQuantity,
    remainingQuantity: Math.max(0, remainingQuantity),
    averageFillPrice,
    ledgerFee,
    fillCount: snapshot.fills.length,
    discrepancyReasons: [...new Set(reasons)],
  };
}
