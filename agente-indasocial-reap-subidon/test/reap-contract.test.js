// Prueba de contrato: corre la historia completa en modo SANDBOX contra un Reap
// falso (test/fakeReap.js) que valida cada petición con los esquemas documentados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/backend.js';
import { createReapClient } from '../src/reap/client.js';
import { fakeReap } from './fakeReap.js';

const BRAND = 'brand_ecofashion';
const STUDIO = 'creator_lumen';
const BRIEF = 'Busco un estudio de producción de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD';

test('contrato Reap sandbox: historia completa con la forma exacta de la API documentada', async () => {
  const fake = fakeReap();
  const reap = createReapClient({ mode: 'sandbox', apiKey: 'sk_test', fetch: fake.fetch });
  const be = createBackend({ reap, publicBaseUrl: 'http://localhost:3000' });
  const call = async (method, path, body, userId = BRAND) => {
    const r = await be.handle(method, path, { body, userId });
    assert.ok(r.status < 400, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  await call('POST', '/api/assistant/messages', { text: BRIEF });
  const prop = await call('POST', `/api/assistant/matches/${STUDIO}/select`);
  await call('POST', `/api/proposals/${prop.id}/accept`, null, STUDIO);
  await call('POST', `/api/proposals/${prop.id}/pay-fee`);

  // Tarjeta: http://localhost es rechazado por Reap -> reintenta con la URL HTTPS de respaldo.
  const card = await call('POST', `/api/brands/${BRAND}/card`);
  assert.equal(card.status, 'REQUIRES_ACTION');
  assert.match(card.cardEntryUrl, /^https:\/\/sandbox\.pay\.reap\.global\//);
  const enrollCalls = fake.log.filter((l) => l.route === 'POST /agentic/enrollments');
  assert.equal(enrollCalls.length, 2);
  assert.equal(enrollCalls[1].body.presentation.returnUrl, 'https://indasocial.com');
  fake.userCompletesCard();
  const status = await call('GET', `/api/brands/${BRAND}/card`);
  assert.equal(status.status, 'ACTIVE');
  assert.deepEqual(status.card, { brand: 'VISA', last4: '2058' });

  // Kit: busca en inglés, omite el equipo del estudio, cotiza con dirección en MX.
  const kit = await call('POST', `/api/proposals/${prop.id}/chat`, { text: '@inda arma el kit de producción: escenografía sostenible y fondo' });
  assert.ok(kit.orders?.length, JSON.stringify(kit));
  assert.ok(kit.trace.some((l) => l.includes('"photography backdrop"')));
  assert.ok(kit.trace.some((l) => /ya tiene/.test(l)));
  assert.ok(kit.total.amount <= 150);
  const searched = fake.log.filter((l) => l.route === 'POST /agentic/products/search').map((l) => l.body.query);
  assert.ok(!searched.includes('ring light') && !searched.includes('microphone'), 'no busca lo que el estudio ya tiene');
  const quote = fake.log.find((l) => l.route === 'POST /agentic/quotes');
  assert.equal(quote.body.shippingAddress.country, 'MX');
  assert.ok(fake.log.some((l) => l.route.endsWith('/shipping-option') && l.body.shippingOptionId === 'std'), 'elige el envío más barato');

  // Aprobación: checkout -> la marca aprueba en Reap -> pedido pagado con orderId.
  for (const o of kit.orders) {
    const pending = await call('POST', `/api/kit-orders/${o.id}/approve`);
    assert.equal(pending.status, 'AWAITING_APPROVAL');
    assert.match(pending.approvalUrl, /^https:\/\/sandbox\.pay\.reap\.global\//);
  }
  fake.userApproves();
  for (const o of kit.orders) {
    const done = await call('GET', `/api/kit-orders/${o.id}`);
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.reapOrderId, 'ORD-1001');
  }
});

test('contrato Reap: los errores de Reap llegan claros a la interfaz', async () => {
  const reap = createReapClient({
    mode: 'sandbox',
    apiKey: 'sk_test',
    fetch: async () => new Response(JSON.stringify({ error: { code: 'AGENTIC_PAYMENTS_NOT_ENABLED', message: 'Agentic Payments is not enabled', detail: null } }), { status: 403 }),
  });
  const be = createBackend({ reap });
  const r = await be.handle('POST', `/api/brands/${BRAND}/card`, { userId: BRAND });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'AGENTIC_PAYMENTS_NOT_ENABLED');
  assert.match(r.body.message, /not enabled/);

  const offline = createReapClient({ mode: 'sandbox', apiKey: 'sk_test', fetch: async () => { throw new Error('ENOTFOUND'); } });
  const r2 = await createBackend({ reap: offline }).handle('GET', '/api/demo', { userId: BRAND });
  assert.equal(r2.status, 200, 'el demo carga aunque Reap no responda (aún sin tarjeta)');
});

async function runToKit(fake) {
  const reap = createReapClient({ mode: 'sandbox', apiKey: 'sk_test', fetch: fake.fetch });
  const be = createBackend({ reap, publicBaseUrl: 'http://localhost:3000' });
  const call = async (method, path, body, userId = BRAND) => (await be.handle(method, path, { body, userId })).body;
  await call('POST', '/api/assistant/messages', { text: BRIEF });
  const prop = await call('POST', `/api/assistant/matches/${STUDIO}/select`);
  await call('POST', `/api/proposals/${prop.id}/accept`, null, STUDIO);
  await call('POST', `/api/proposals/${prop.id}/pay-fee`);
  return call('POST', `/api/proposals/${prop.id}/chat`, { text: '@inda arma el kit de producción: escenografía sostenible y fondo' });
}

test('contrato Reap: omite productos en otra moneda y elige los que cobran en USD', async () => {
  const fake = fakeReap();
  const kit = await runToKit(fake);
  assert.ok(kit.orders.length);
  for (const o of kit.orders) assert.equal(o.amount.currency, 'USD');
  assert.ok(!kit.orders.some((o) => o.merchant === 'bashfashion'), 'no compra en GBP');
  const searches = fake.log.filter((l) => l.route === 'POST /agentic/products/search');
  assert.ok(searches.some((l) => !l.body.context), 'si con país MX no hay resultados, busca sin filtro de país');
});

test('contrato Reap: si los comercios no envían a México, el Asistente Inda lo explica', async () => {
  const kit = await runToKit(fakeReap({ shipsTo: ['US'] }));
  assert.equal(kit.error, 'QUOTE_REJECTED');
  assert.match(kit.reply, /No pude armar el kit: Ningún comercio pudo cotizar con envío/);
});

test('contrato Reap: con REAP_SANDBOX_SHIP_TO=US cotiza con la dirección de prueba en EE. UU.', async () => {
  process.env.REAP_SANDBOX_SHIP_TO = 'US';
  try {
    const fake = fakeReap({ shipsTo: ['US'] });
    const kit = await runToKit(fake);
    assert.ok(kit.orders?.length, JSON.stringify(kit));
    assert.ok(kit.trace.some((l) => /dirección de prueba en EE\. UU\./.test(l)));
    assert.ok(fake.log.filter((l) => l.route === 'POST /agentic/quotes').every((l) => l.body.shippingAddress.country === 'US'));
  } finally {
    delete process.env.REAP_SANDBOX_SHIP_TO;
  }
});
