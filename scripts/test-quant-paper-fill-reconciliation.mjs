import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { reconcilePaperOrder } from '../src/server/quant/paperOrderReconciliation.js';

const prisma = new PrismaClient();
const USER_A = 'quant-recon-user-a';
const USER_B = 'quant-recon-user-b';

async function snapshot(orderId, userId = USER_A) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT o.id, o.symbol, o.side, o.status, o.quantity::text AS quantity,
           o.filled_quantity::text AS filled_quantity,
           o.remaining_quantity::text AS remaining_quantity,
           o.average_fill_price::text AS average_fill_price,
           o.fill_price::text AS fill_price, o.fee::text AS fee,
           COALESCE(json_agg(json_build_object(
             'id', t.id,
             'clientFillId', t.client_fill_id,
             'quantity', t.quantity::text,
             'price', t.price::text,
             'fee', t.fee::text
           ) ORDER BY t.created_at, t.id) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS fills
    FROM quant_paper_orders o
    LEFT JOIN quant_paper_trades t
      ON t.order_id = o.id AND t.user_id = o.user_id
    WHERE o.id = $1 AND o.user_id = $2
    GROUP BY o.id
  `, orderId, userId);
  assert.equal(rows.length, 1, `expected exactly one order row for ${orderId}`);
  const row = rows[0];
  const fills = Array.isArray(row.fills) ? row.fills : JSON.parse(row.fills);
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    status: row.status,
    quantity: Number(row.quantity),
    storedFilledQuantity: Number(row.filled_quantity),
    storedRemainingQuantity: Number(row.remaining_quantity),
    storedAverageFillPrice: row.average_fill_price === null ? null : Number(row.average_fill_price),
    storedFillPrice: Number(row.fill_price),
    storedFee: Number(row.fee),
    fills: fills.map((fill) => ({
      id: String(fill.id),
      clientFillId: String(fill.clientFillId),
      quantity: Number(fill.quantity),
      price: Number(fill.price),
      fee: Number(fill.fee),
    })),
  };
}

async function seedPostMigrationFixtures() {
  await prisma.$executeRawUnsafe(
    'DELETE FROM quant_paper_orders WHERE id IN ($1, $2)',
    'quant-recon-partial', 'quant-recon-duplicate',
  );

  await prisma.$executeRawUnsafe(`
    INSERT INTO quant_paper_orders
      (id, user_id, client_order_id, symbol, side, quantity, reference_price,
       fill_price, fee, status, filled_quantity, remaining_quantity,
       average_fill_price, created_at, updated_at)
    VALUES
      ('quant-recon-partial', $1, 'partial-client-order', 'NVDA', 'buy',
       10, 100, 101, 0.20, 'partially_filled', 4, 6, 101, NOW(), NOW())
  `, USER_A);

  await prisma.$executeRawUnsafe(`
    INSERT INTO quant_paper_trades
      (id, order_id, user_id, symbol, side, quantity, price, fee, created_at)
    VALUES
      ('quant-recon-partial-fill-1', 'quant-recon-partial', $1, 'NVDA', 'buy',
       2, 100, 0.10, NOW()),
      ('quant-recon-partial-fill-2', 'quant-recon-partial', $1, 'NVDA', 'buy',
       2, 102, 0.10, NOW())
  `, USER_A);

  await prisma.$executeRawUnsafe(`
    INSERT INTO quant_paper_orders
      (id, user_id, client_order_id, symbol, side, quantity, reference_price,
       fill_price, fee, status, created_at)
    VALUES
      ('quant-recon-duplicate', $1, 'duplicate-client-order', 'TSLA', 'buy',
       1, 50, 50, 0.10, 'filled', NOW())
  `, USER_A);

  await prisma.$executeRawUnsafe(`
    INSERT INTO quant_paper_trades
      (id, order_id, user_id, symbol, side, quantity, price, fee, client_fill_id, created_at)
    VALUES
      ('quant-recon-duplicate-fill-1', 'quant-recon-duplicate', $1, 'TSLA', 'buy',
       1, 50, 0.10, 'duplicate-client-fill', NOW())
  `, USER_A);
}

async function expectRejected(label, operation, expectedText) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} must be rejected by PostgreSQL`);
  assert.match(String(caught.message ?? caught), expectedText);
  return true;
}

try {
  await seedPostMigrationFixtures();

  const historicalFull = reconcilePaperOrder(
    await snapshot('quant-recon-legacy-full'),
  );
  assert.equal(historicalFull.consistent, true, 'valid pre-migration full fill must reconcile');
  assert.equal(historicalFull.ledgerFilledQuantity, 10);
  assert.equal(historicalFull.averageFillPrice, 100);

  const historicalMissingTrade = reconcilePaperOrder(
    await snapshot('quant-recon-legacy-no-trade'),
  );
  assert.equal(historicalMissingTrade.consistent, false,
    'historical order without a trade must be surfaced as inconsistent');
  assert.ok(historicalMissingTrade.discrepancyReasons.includes('stored_filled_quantity_mismatch'));

  const partialSnapshot = await snapshot('quant-recon-partial');
  const partial = reconcilePaperOrder(partialSnapshot);
  assert.equal(partial.consistent, true, 'two partial fills must reconcile');
  assert.equal(partial.ledgerFilledQuantity, 4);
  assert.equal(partial.remainingQuantity, 6);
  assert.equal(partial.averageFillPrice, 101);
  assert.equal(partial.ledgerFee, 0.2);
  assert.deepEqual(
    partialSnapshot.fills.map((fill) => fill.clientFillId).sort(),
    [
      'paper:partial-client-order:quant-recon-partial-fill-1',
      'paper:partial-client-order:quant-recon-partial-fill-2',
    ],
  );

  const duplicateSnapshot = await snapshot('quant-recon-duplicate');
  const duplicateBefore = reconcilePaperOrder(duplicateSnapshot);
  assert.equal(duplicateBefore.consistent, true);
  await expectRejected(
    'duplicate user-scoped client fill identifier',
    () => prisma.$executeRawUnsafe(`
      INSERT INTO quant_paper_trades
        (id, order_id, user_id, symbol, side, quantity, price, fee, client_fill_id, created_at)
      VALUES
        ('quant-recon-duplicate-fill-2', 'quant-recon-duplicate', $1, 'TSLA', 'buy',
         1, 50, 0.10, 'duplicate-client-fill', NOW())
    `, USER_A),
    /unique|duplicate/i,
  );

  await expectRejected(
    'cross-account fill referencing another user\'s order',
    () => prisma.$executeRawUnsafe(`
      INSERT INTO quant_paper_trades
        (id, order_id, user_id, symbol, side, quantity, price, fee, client_fill_id, created_at)
      VALUES
        ('quant-recon-cross-user-fill', 'quant-recon-partial', $1, 'NVDA', 'buy',
         1, 101, 0.01, 'cross-user-fill', NOW())
    `, USER_B),
    /unknown order/i,
  );

  const crossAccountDuplicateRejected = await expectRejected(
    'cross-account fill cannot reuse another account existing client fill id',
    () => prisma.$executeRawUnsafe(`
      INSERT INTO quant_paper_trades
        (id, order_id, user_id, symbol, side, quantity, price, fee, client_fill_id, created_at)
      VALUES
        ('quant-recon-cross-user-duplicate-fill', 'quant-recon-partial', $1, 'NVDA', 'buy',
         1, 101, 0.01, 'duplicate-client-fill', NOW())
    `, USER_B),
    /unknown order/i,
  );
  assert.equal(crossAccountDuplicateRejected, true,
    'cross-account duplicate fill identifiers must be rejected');

  const afterFirstRun = {
    historicalFull: reconcilePaperOrder(await snapshot('quant-recon-legacy-full')),
    historicalMissingTrade: reconcilePaperOrder(await snapshot('quant-recon-legacy-no-trade')),
    partial: reconcilePaperOrder(await snapshot('quant-recon-partial')),
    duplicate: reconcilePaperOrder(await snapshot('quant-recon-duplicate')),
  };
  const afterSecondRead = {
    historicalFull: reconcilePaperOrder(await snapshot('quant-recon-legacy-full')),
    historicalMissingTrade: reconcilePaperOrder(await snapshot('quant-recon-legacy-no-trade')),
    partial: reconcilePaperOrder(await snapshot('quant-recon-partial')),
    duplicate: reconcilePaperOrder(await snapshot('quant-recon-duplicate')),
  };
  assert.deepEqual(afterSecondRead, afterFirstRun,
    'reconciliation results must be deterministic and read-only across repeated scans');

  console.log(JSON.stringify({
    result: 'PASS',
    historicalFull: afterFirstRun.historicalFull.consistent,
    historicalMissingTrade: afterFirstRun.historicalMissingTrade.discrepancyReasons,
    partialFill: {
      consistent: afterFirstRun.partial.consistent,
      filled: afterFirstRun.partial.ledgerFilledQuantity,
      remaining: afterFirstRun.partial.remainingQuantity,
      averagePrice: afterFirstRun.partial.averageFillPrice,
    },
    duplicateClientFillRejected: true,
    crossAccountFillRejected: true,
    crossAccountDuplicateClientFillRejected: true,
    repeatedScanDeterministic: true,
    database: 'disposable PostgreSQL only',
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
