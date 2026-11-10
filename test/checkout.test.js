import assert from 'node:assert/strict';
import test from 'node:test';
import { applySettlement, daysLeft, extendEntitlement, isActive, readHeader } from '../dist/checkout/index.js';

const month = { id: 'month', days: 30, price: { amount: 21000, currency: 'SAT' }, providerRef: 'prod-1' };
const DAY = 86_400_000;

function memoryStore(checkouts) {
  const settled = new Set();
  const passes = new Map();
  return {
    passes,
    async findCheckout(id) {
      return checkouts.find((c) => c.id === id) ?? null;
    },
    async settleOnce(checkout, grant) {
      if (settled.has(checkout.id)) return null;
      settled.add(checkout.id);
      const next = grant(passes.get(checkout.reference) ?? null);
      passes.set(checkout.reference, next);
      return next;
    },
  };
}
const checkout = { id: 'pi-1', reference: 'user-1', planId: 'month', amount: month.price };
const event = (over = {}) => ({ provider: 'x', externalId: 'pi-1', amount: { amount: 21000, currency: 'SAT' }, providerRef: 'prod-1', eventId: null, ...over });

test('a first payment runs for the plan\'s days from when it was paid', () => {
  const paidAt = new Date('2026-11-10T12:00:00Z');
  const pass = extendEntitlement(null, month, paidAt);
  assert.equal(pass.expiresAt, '2026-12-10T12:00:00.000Z');
  assert.equal(isActive(pass, paidAt), true);
  assert.equal(isActive(pass, new Date('2026-12-10T12:00:00Z')), false);
  assert.equal(daysLeft(pass, paidAt), 30);
});

test('renewing early adds the days to the end; renewing late starts from the payment', () => {
  const pass = { planId: 'month', expiresAt: '2026-11-20T00:00:00.000Z' };
  assert.equal(extendEntitlement(pass, month, new Date('2026-11-10T00:00:00Z')).expiresAt, '2026-12-20T00:00:00.000Z');
  assert.equal(extendEntitlement(pass, month, new Date('2026-12-01T00:00:00Z')).expiresAt, '2026-12-31T00:00:00.000Z');
  assert.equal(isActive(null), false);
  assert.equal(daysLeft(null), 0);
});

test('a settlement grants the pass once, however often it is delivered', async () => {
  const store = memoryStore([checkout]);
  const paidAt = new Date('2026-11-10T00:00:00Z');
  const first = await applySettlement({ event: event(), plans: [month], store, paidAt });
  assert.equal(first.outcome, 'granted');
  assert.equal(first.reference, 'user-1');
  const again = await applySettlement({ event: event(), plans: [month], store, paidAt });
  assert.equal(again.outcome, 'duplicate');
  assert.equal(new Date(store.passes.get('user-1').expiresAt).getTime(), paidAt.getTime() + 30 * DAY);
});

test('a payment that is not one of ours, underpaid, or for another product grants nothing', async () => {
  const store = memoryStore([checkout]);
  assert.equal((await applySettlement({ event: event({ externalId: 'other' }), plans: [month], store })).outcome, 'unknown-checkout');
  assert.equal((await applySettlement({ event: event({ amount: { amount: 20999, currency: 'SAT' } }), plans: [month], store })).outcome, 'underpaid');
  assert.equal((await applySettlement({ event: event({ amount: { amount: 21000, currency: 'CHF' } }), plans: [month], store })).outcome, 'underpaid');
  assert.equal((await applySettlement({ event: event({ providerRef: 'prod-2' }), plans: [month], store })).outcome, 'wrong-product');
  assert.equal((await applySettlement({ event: event(), plans: [], store })).outcome, 'unknown-plan');
  assert.equal(store.passes.size, 0);
});

test('a provider that states no amount or product is taken at the stored checkout', async () => {
  const store = memoryStore([checkout]);
  const result = await applySettlement({ event: event({ amount: null, providerRef: null }), plans: [month], store });
  assert.equal(result.outcome, 'granted');
});

test('readHeader reads a Headers object and a plain record, case-insensitively', () => {
  assert.equal(readHeader(new Headers({ 'X-Thing': 'a' }), 'x-thing'), 'a');
  assert.equal(readHeader({ 'X-Thing': ['b', 'c'] }, 'x-thing'), 'b');
  assert.equal(readHeader({}, 'x-thing'), null);
});
