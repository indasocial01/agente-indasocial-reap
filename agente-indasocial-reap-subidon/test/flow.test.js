import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReapClient } from '../src/reap/client.js';
import { DEMO_BRAND_ID } from '../src/seed.js';
import { setup, paidDeal, storeCard, STUDIO } from './helpers.js';

test('kit de producción: chat -> plan -> aprobación en Reap -> pedido pagado', async () => {
  const t = setup();
  const p = await paidDeal(t);
  await storeCard(t);

  const res = await t.inda.chat({
    proposalId: p.id,
    senderId: DEMO_BRAND_ID,
    text: '@inda arma el kit de producción: escenografía sostenible',
  });
  assert.ok(res.orders.length >= 1);
  assert.ok(res.total.amount <= p.productionBudget.amount, `total ${res.total.amount}`);

  const order = res.orders[0];
  const pending = await t.inda.requestApproval({ orderId: order.id, requestedBy: DEMO_BRAND_ID });
  assert.equal(pending.status, 'AWAITING_APPROVAL');
  assert.equal((await t.inda.syncOrder({ orderId: order.id })).status, 'AWAITING_APPROVAL');

  t.reap._decideCheckout(pending.checkoutId, true);
  const done = await t.inda.syncOrder({ orderId: order.id });
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.reapOrderId);
  assert.deepEqual(done.finalAmount, done.amount);
});

test('el kit no vuelve a comprar el equipo que el estudio ya tiene', async () => {
  const t = setup();
  const p = await paidDeal(t);
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'luz, audio y escenografía sostenible' });
  const bought = r.orders.flatMap((o) => o.items.map((i) => i.name)).join(' | ');
  assert.doesNotMatch(bought, /Aro de luz|Micrófono|Tripié/);
  assert.deepEqual(r.skipped.map((s) => s.key).sort(), ['audio', 'luz', 'tripie']);
});

test('el Asistente Inda respeta el presupuesto de producción', async () => {
  const t = setup();
  const p = await paidDeal(t);
  t.store.saveProposal({ ...p, productionBudget: { amount: 40, currency: 'USD' } });
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'props fondo telas' });
  assert.ok(r.total.amount <= 40, `total ${r.total.amount}`);
});

test('si nada cabe en el presupuesto, no compra', async () => {
  const t = setup();
  const p = await paidDeal(t);
  t.store.saveProposal({ ...p, productionBudget: { amount: 5, currency: 'USD' } });
  await assert.rejects(t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID }), (e) => ['NOTHING_TO_BUY', 'OVER_BUDGET'].includes(e.code));
});

test('solo la marca de la propuesta puede pedirle compras al Asistente Inda', async () => {
  const t = setup();
  const p = await paidDeal(t);
  await assert.rejects(t.inda.planKit({ proposalId: p.id, requestedBy: STUDIO }), { code: 'FORBIDDEN' });
});

test('no hay kit antes de aceptar la propuesta ni antes de pagar el servicio', async () => {
  const t = setup();
  const sent = await paidDeal(t, { accept: false });
  await assert.rejects(t.inda.planKit({ proposalId: sent.id, requestedBy: DEMO_BRAND_ID }), { code: 'PROPOSAL_NOT_ACCEPTED' });
  t.deals.respond({ proposalId: sent.id, userId: STUDIO, accept: true });
  await assert.rejects(t.inda.planKit({ proposalId: sent.id, requestedBy: DEMO_BRAND_ID }), { code: 'FEE_PENDING' });
});

test('pide tarjeta antes de cobrar', async () => {
  const t = setup();
  const p = await paidDeal(t);
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'props' });
  await assert.rejects(t.inda.requestApproval({ orderId: r.orders[0].id, requestedBy: DEMO_BRAND_ID }), { code: 'CARD_REQUIRED' });
});

test('re-cotiza si la cotización expiró antes de aprobar', async () => {
  const t = setup({ quoteTtlMs: 60_000 });
  const p = await paidDeal(t);
  await storeCard(t);
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'props' });
  const oldQuote = r.orders[0].quoteId;
  t.advance(120_000);
  const pending = await t.inda.requestApproval({ orderId: r.orders[0].id, requestedBy: DEMO_BRAND_ID });
  assert.notEqual(pending.quoteId, oldQuote);
  assert.equal(pending.status, 'AWAITING_APPROVAL');
});

test('si la marca rechaza en Reap, el pedido queda cancelado', async () => {
  const t = setup();
  const p = await paidDeal(t);
  await storeCard(t);
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'props' });
  const pending = await t.inda.requestApproval({ orderId: r.orders[0].id, requestedBy: DEMO_BRAND_ID });
  t.reap._decideCheckout(pending.checkoutId, false);
  assert.equal((await t.inda.syncOrder({ orderId: r.orders[0].id })).status, 'CANCELED');
});

test('no deja aprobar dos veces el mismo pedido', async () => {
  const t = setup();
  const p = await paidDeal(t);
  await storeCard(t);
  const r = await t.inda.planKit({ proposalId: p.id, requestedBy: DEMO_BRAND_ID, message: 'props' });
  await t.inda.requestApproval({ orderId: r.orders[0].id, requestedBy: DEMO_BRAND_ID });
  await assert.rejects(t.inda.requestApproval({ orderId: r.orders[0].id, requestedBy: DEMO_BRAND_ID }), { code: 'INVALID_STATE' });
});

test('mensajes sin @inda no disparan compras', async () => {
  const t = setup();
  const p = await paidDeal(t);
  assert.equal(await t.inda.chat({ proposalId: p.id, senderId: DEMO_BRAND_ID, text: '¡Hola equipo Lumen!' }), null);
});

test('modo sandbox exige API key', () => {
  const prev = process.env.REAP_API_KEY;
  delete process.env.REAP_API_KEY;
  assert.throws(() => createReapClient({ mode: 'sandbox' }), /REAP_API_KEY/);
  if (prev) process.env.REAP_API_KEY = prev;
});

test('cliente sandbox manda los headers que pide Reap', async () => {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 'chk_1', status: 'REQUIRES_ACTION' }), { status: 200 });
  };
  try {
    const c = createReapClient({ mode: 'sandbox', apiKey: 'test_key', simulateCheckout: 'COMPLETED' });
    await c.createCheckout({ quoteId: 'q', enrollmentId: 'e' });
    const h = calls[0].init.headers;
    assert.equal(calls[0].url, 'https://sg.sandbox.api.reap.global/agentic/checkouts');
    assert.equal(h.Authorization, 'Bearer test_key');
    assert.equal(h['Reap-Version'], '2025-02-14');
    assert.equal(h['X-Simulate-Checkout'], 'COMPLETED');
    assert.ok(h['Idempotency-Key']);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('un solo agente: @inda arma el kit y @agente funciona como alias', async () => {
  for (const mention of ['@inda', '@agente']) {
    const t = setup();
    const p = await paidDeal(t);
    await storeCard(t);
    const res = await t.inda.chat({ proposalId: p.id, senderId: DEMO_BRAND_ID, text: `${mention} arma el kit de producción: escenografía sostenible` });
    assert.ok(res.orders.length > 0, mention);
    const last = t.store.listMessages(p.id).at(-1);
    assert.equal(last.from, 'inda');
  }
  assert.equal(setup().inda.name, 'Asistente Inda');
});
