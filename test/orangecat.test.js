import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { OrangeCatError, orangeCatProvider, signOrangeCatPayload, verifyOrangeCatSignature } from '../dist/orangecat/index.js';

const secret = 'ock_whk_test';
const now = new Date('2026-11-10T12:00:00Z');
const month = { id: 'month', days: 30, price: { amount: 21000, currency: 'SAT' }, providerRef: '11111111-1111-4111-8111-111111111111' };
const settled = JSON.stringify({ type: 'payment.settled', intentKind: 'support', entityType: 'product', entityId: month.providerRef, amountBtc: '0.00021', externalId: 'pi-1' });

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('the signature is HMAC-SHA-256 over `${t}.${rawBody}`, as OrangeCat signs it', () => {
  const t = Math.floor(now.getTime() / 1000);
  const byHand = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${settled}`).digest('hex')}`;
  assert.equal(signOrangeCatPayload(settled, secret, now), byHand);
  assert.deepEqual(verifyOrangeCatSignature(settled, secret, byHand, { now }), { valid: true });
});

test('a wrong secret, a changed body, an old timestamp and a broken header are each refused', () => {
  const header = signOrangeCatPayload(settled, secret, now);
  assert.equal(verifyOrangeCatSignature(settled, 'other', header, { now }).reason, 'signature_mismatch');
  assert.equal(verifyOrangeCatSignature(settled + ' ', secret, header, { now }).reason, 'signature_mismatch');
  assert.equal(verifyOrangeCatSignature(settled, secret, header, { now: new Date(now.getTime() + 301_000) }).reason, 'timestamp_outside_tolerance');
  assert.equal(verifyOrangeCatSignature(settled, secret, header, { now: new Date(now.getTime() + 300_000) }).valid, true);
  assert.equal(verifyOrangeCatSignature(settled, secret, null, { now }).reason, 'malformed_header');
  assert.equal(verifyOrangeCatSignature(settled, secret, 'v1=abc', { now }).reason, 'malformed_header');
  assert.equal(verifyOrangeCatSignature(settled, secret, 't=abc,v1=abc', { now }).reason, 'malformed_header');
  assert.equal(verifyOrangeCatSignature(settled, secret, `t=${Math.floor(now.getTime() / 1000)}`, { now }).reason, 'unknown_scheme');
  assert.equal(verifyOrangeCatSignature(settled, secret, `t=${Math.floor(now.getTime() / 1000)},v1=zz`, { now }).reason, 'signature_mismatch');
});

test('createCheckout asks for an account-less invoice and keeps what the app must store', async () => {
  const calls = [];
  const provider = orangeCatProvider({
    now: () => now,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return json(201, {
        success: true,
        data: {
          payment_intent: { id: 'pi-1', amount_btc: 0.00021, payment_method: 'nwc', status: 'invoice_ready', expires_at: '2026-11-10T12:10:00.000Z' },
          status_token: 'tok',
          qr_data: 'LNBC210U1EXAMPLE',
          method_label: 'Lightning',
          expires_in_seconds: 600,
        },
      });
    },
  });
  const checkout = await provider.createCheckout({ plan: month, reference: 'user-1' });
  assert.equal(calls[0].url, 'https://orangecat.ch/api/v1/payments/public');
  assert.deepEqual(JSON.parse(calls[0].init.body), { entity_type: 'product', entity_id: month.providerRef, amount_btc: 0.00021 });
  // No key, and the buyer's reference never leaves the app.
  assert.equal(JSON.stringify(calls[0].init).includes('user-1'), false);
  assert.deepEqual(checkout, {
    provider: 'orangecat',
    id: 'pi-1',
    reference: 'user-1',
    planId: 'month',
    amount: { amount: 21000, currency: 'SAT' },
    invoice: 'LNBC210U1EXAMPLE',
    payUrl: 'lightning:LNBC210U1EXAMPLE',
    expiresAt: '2026-11-10T12:10:00.000Z',
    handle: 'tok',
  });
});

test('an on-chain request is a bitcoin: URI and is linked as it is', async () => {
  const provider = orangeCatProvider({
    now: () => now,
    fetch: async () => json(201, { success: true, data: { payment_intent: { id: 'pi-2' }, status_token: 'tok', qr_data: 'bitcoin:bc1qexample?amount=0.00021', expires_in_seconds: 60 } }),
  });
  const checkout = await provider.createCheckout({ plan: month, reference: 'u' });
  assert.equal(checkout.payUrl, 'bitcoin:bc1qexample?amount=0.00021');
  assert.equal(checkout.expiresAt, '2026-11-10T12:01:00.000Z');
});

test('a plan not priced in whole SAT is refused before anything is sent', async () => {
  const provider = orangeCatProvider({ fetch: async () => assert.fail('no request expected') });
  await assert.rejects(provider.createCheckout({ plan: { ...month, price: { amount: 900, currency: 'CHF' } }, reference: 'u' }), OrangeCatError);
  await assert.rejects(provider.createCheckout({ plan: { ...month, price: { amount: 0.5, currency: 'SAT' } }, reference: 'u' }), OrangeCatError);
});

test('OrangeCat\'s own error message reaches the caller', async () => {
  const provider = orangeCatProvider({
    fetch: async () => json(400, { success: false, error: { code: 'BAD_REQUEST', message: 'The owner has not connected a Bitcoin wallet yet.' } }),
  });
  await assert.rejects(provider.createCheckout({ plan: month, reference: 'u' }), (error) => {
    assert.equal(error.message, 'The owner has not connected a Bitcoin wallet yet.');
    assert.equal(error.status, 400);
    return true;
  });
});

test('status sends the handle and maps OrangeCat\'s states', async () => {
  const seen = [];
  const answers = ['invoice_ready', 'buyer_confirmed', 'paid', 'expired', 'failed'];
  const provider = orangeCatProvider({
    fetch: async (url, init) => {
      seen.push({ url, token: init.headers['x-payment-token'] });
      const status = answers.shift();
      return json(200, { success: true, data: { status, paid_at: status === 'paid' ? '2026-11-10T12:01:00.000Z' : null } });
    },
  });
  const states = [];
  for (let i = 0; i < 5; i++) states.push(await provider.status({ id: 'pi-1', handle: 'tok' }));
  assert.deepEqual(seen[0], { url: 'https://orangecat.ch/api/v1/payments/public/pi-1', token: 'tok' });
  assert.deepEqual(states.map((s) => s.state), ['pending', 'pending', 'paid', 'expired', 'failed']);
  assert.equal(states[2].paidAt, '2026-11-10T12:01:00.000Z');
  await assert.rejects(provider.status({ id: 'pi-1' }), OrangeCatError);
});

test('verifyWebhook turns an authentic payment.settled into a settled event', () => {
  const provider = orangeCatProvider({ webhookSecret: secret, now: () => now });
  const headers = new Headers({ 'X-OrangeCat-Signature': signOrangeCatPayload(settled, secret, now), 'X-OrangeCat-Event-Id': 'evt-1' });
  assert.deepEqual(provider.verifyWebhook(settled, headers), {
    ok: true,
    event: { provider: 'orangecat', externalId: 'pi-1', amount: { amount: 21000, currency: 'SAT' }, providerRef: month.providerRef, eventId: 'evt-1' },
  });
});

test('verifyWebhook acknowledges other authentic events and refuses everything unauthentic', () => {
  const provider = orangeCatProvider({ webhookSecret: secret, now: () => now });
  const other = JSON.stringify({ type: 'product.created' });
  assert.deepEqual(provider.verifyWebhook(other, { 'x-orangecat-signature': signOrangeCatPayload(other, secret, now) }), { ok: true, event: null });
  assert.equal(provider.verifyWebhook(settled, {}).ok, false);
  assert.equal(provider.verifyWebhook(settled, { 'x-orangecat-signature': signOrangeCatPayload(settled, 'forged', now) }).ok, false);
  const noId = JSON.stringify({ type: 'payment.settled' });
  assert.equal(provider.verifyWebhook(noId, { 'x-orangecat-signature': signOrangeCatPayload(noId, secret, now) }).ok, false);
  // No secret configured: nothing can be authentic.
  const open = orangeCatProvider({ now: () => now });
  assert.deepEqual(open.verifyWebhook(settled, { 'x-orangecat-signature': signOrangeCatPayload(settled, secret, now) }), { ok: false, reason: 'no_webhook_secret' });
});

test('payee reads the receiving entity from OrangeCat, and never says no on the strength of a missing field', async () => {
  const seen = [];
  const answers = [
    { id: 'p', title: 'Heidi', bitcoin_address: null, lightning_address: null },
    { id: 'p', title: 'Heidi', bitcoin_address: null, lightning_address: 'heidi@example.com' },
  ];
  const provider = orangeCatProvider({
    entityType: 'project',
    fetch: async (url) => {
      seen.push(url);
      return json(200, { success: true, data: answers.shift() });
    },
  });
  // No address on the public record is not a no: the owner's wallet is not part of it.
  assert.deepEqual(await provider.payee('p'), { name: 'Heidi', url: 'https://orangecat.ch/projects/p', payable: null });
  assert.equal((await provider.payee('p')).payable, true);
  assert.equal(seen[0], 'https://orangecat.ch/api/v1/projects/p');
});
