// Comprueba que el motor del navegador (public/engine.js) recorre la historia
// completa sin servidor y que el estado sobrevive a recargar la página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/engine.js', import.meta.url), 'utf8');

function loadEngine(storage) {
  const ctx = {
    console,
    crypto: globalThis.crypto,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => (storage[k] = String(v)),
      removeItem: (k) => delete storage[k],
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.IndaEngine.createLocalBackend();
}

const BRAND = 'brand_ecofashion';
const STUDIO = 'creator_lumen';

test('engine.js: historia completa en el navegador y estado persistente', async () => {
  const storage = {};
  let be = loadEngine(storage);
  const call = async (m, p, body, user = BRAND) => {
    const r = await be.request(m, p, body, user);
    assert.ok(r.status < 400, `${m} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  const a = await call('POST', '/api/assistant/messages', { text: 'Busco un estudio de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD' });
  assert.equal(a.matches[0].creator.id, STUDIO);
  const prop = await call('POST', `/api/assistant/matches/${STUDIO}/select`);
  await call('POST', `/api/proposals/${prop.id}/accept`, null, STUDIO);
  await call('POST', `/api/proposals/${prop.id}/pay-fee`);

  // "Recargar la página": nuevo motor, mismo localStorage
  be = loadEngine(storage);
  const card = await call('POST', `/api/brands/${BRAND}/card`);
  assert.match(card.cardEntryUrl, /\/mock-reap\/enroll\//);
  await call('POST', `/api/sim/enroll/${card.enrollmentId}`);

  const kit = await call('POST', `/api/proposals/${prop.id}/chat`, { text: '@inda arma el kit de producción: escenografía sostenible y fondo' });
  const order = await call('POST', `/api/kit-orders/${kit.orders[0].id}/approve`);
  const checkoutId = order.approvalUrl.split('/').pop();
  await call('POST', `/api/sim/approve/${checkoutId}`, { approve: true });

  be = loadEngine(storage);
  const synced = await call('GET', `/api/kit-orders/${order.id}`);
  assert.equal(synced.status, 'COMPLETED');
  const demo = await call('GET', '/api/demo');
  assert.equal(demo.proposal.status, 'accepted');
  assert.equal(demo.card.status, 'ACTIVE');
});

test('el Asistente Inda devuelve su registro de pasos (trace) en sus dos habilidades', async () => {
  const be = loadEngine({});
  const call = async (m, p, body, user = BRAND) => (await be.request(m, p, body, user)).body;
  const a = await call('POST', '/api/assistant/messages', { text: 'Busco un estudio de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD' });
  assert.ok(a.trace.length >= 4);
  assert.ok(a.trace.some((l) => /Ignoré el texto libre/.test(l)));
  const prop = await call('POST', `/api/assistant/matches/${STUDIO}/select`);
  await call('POST', `/api/proposals/${prop.id}/accept`, null, STUDIO);
  await call('POST', `/api/proposals/${prop.id}/pay-fee`);
  const kit = await call('POST', `/api/proposals/${prop.id}/chat`, { text: '@inda arma el kit de producción: escenografía sostenible y fondo' });
  assert.ok(kit.trace.some((l) => l.startsWith('Reap · busqué')));
  assert.ok(kit.trace.some((l) => l.startsWith('Reap · coticé')));
  assert.ok(kit.trace.some((l) => /ya tiene/.test(l)));
  const demo = await call('GET', '/api/demo');
  assert.deepEqual(demo.chat.find((m) => m.from === 'inda' && m.orderIds).trace, kit.trace);
});
