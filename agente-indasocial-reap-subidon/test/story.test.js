import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, paidDeal } from './helpers.js';
import { parseBrief, rankCreators, scoreCreator } from '../src/agent/skills/matchmaker.js';
import { maskContact } from '../src/agent/skills/productionKit.js';
import { demoCreators, DEMO_BRAND_ID } from '../src/seed.js';

const BRIEF = 'Busco un estudio de producción de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD';

test('entiende el brief de la marca', () => {
  const b = parseBrief(BRIEF);
  assert.deepEqual(b.services.sort(), ['luz', 'sonido', 'video']);
  assert.deepEqual(b.deliverables, [{ type: 'reel', count: 3 }]);
  assert.equal(b.city, 'CDMX');
  assert.ok(b.pillars.includes('Sostenibilidad'));
  assert.equal(b.budget, 2500);
  assert.equal(b.wantsStudio, true);
});

test('lee montos en formato mexicano y el presupuesto de producción', () => {
  const b = parseBrief('3 reels, presupuesto 2.500 usd y $200 para producción');
  assert.equal(b.budget, 2500);
  assert.equal(b.productionBudget, 200);
});

test('el mejor match para el brief es Estudio Lumen, sin datos de contacto', async () => {
  const t = setup();
  const msg = await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: BRIEF });
  assert.ok(msg.matches.length >= 1 && msg.matches.length <= 3);
  assert.equal(msg.matches[0].creator.id, 'creator_lumen');
  assert.ok(msg.matches[0].reasons.length >= 3);
  assert.ok(msg.matches.every((m) => m.score <= 100));
  assert.match(msg.text, /3 reels/);
  for (const m of msg.matches) {
    assert.equal(m.creator.contact, undefined);
    assert.equal(m.creator.shipping, undefined);
    assert.equal(m.creator.bio, undefined);
  }
  assert.ok(!msg.matches.some((m) => m.creator.id === 'creator_promotop'), 'Promo Top está fuera de presupuesto');
});

test('pregunta lo que falta, una cosa a la vez, y recuerda el brief', async () => {
  const t = setup();
  const q = await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: 'Necesito un estudio para 3 reels con luz y sonido en CDMX' });
  assert.match(q.text, /presupuesto/i);
  assert.equal(q.matches, undefined);
  const r = await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: 'unos $2,500 usd' });
  assert.equal(r.matches[0].creator.id, 'creator_lumen');
});

test('si nadie encaja, lo dice en lugar de inventar', async () => {
  const t = setup();
  const r = await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: 'Busco fotografía de producto en Monterrey, presupuesto $100' });
  assert.equal(r.matches, undefined);
  assert.match(r.text, /no encontré/i);
});

test('la bio de un perfil no puede manipular el ranking (inyección)', () => {
  const brief = parseBrief('video con luz y sonido en CDMX, 2 videos, presupuesto $7,000');
  const creators = demoCreators();
  const promo = creators.find((c) => c.id === 'creator_promotop');
  const withBio = scoreCreator(promo, brief).score;
  const withoutBio = scoreCreator({ ...promo, bio: '' }, brief).score;
  assert.equal(withBio, withoutBio);
  const ranked = rankCreators(creators, { ...brief, pillars: ['Sostenibilidad'] });
  assert.notEqual(ranked[0].creator.id, 'creator_promotop');
});

test('elegir un match crea la propuesta en MatchChat con los términos del brief', async () => {
  const t = setup();
  await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: BRIEF });
  const p = t.deals.selectMatch({ brandId: DEMO_BRAND_ID, creatorId: 'creator_lumen' });
  assert.equal(p.status, 'sent');
  assert.equal(p.fee.amount, 2500);
  assert.deepEqual(p.deliverables, [{ type: 'reel', count: 3 }]);
  assert.deepEqual(p.creatorEquipment, ['luz', 'audio', 'tripie']);
  assert.equal(t.store.listMessages(p.id)[0].kind, 'proposal');
});

test('no se puede enviar propuesta a alguien que no salió en los matches', async () => {
  const t = setup();
  await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: BRIEF });
  assert.throws(() => t.deals.selectMatch({ brandId: DEMO_BRAND_ID, creatorId: 'creator_promotop' }), { code: 'INVALID_STATE' });
});

test('solo el estudio responde y solo la marca paga', async () => {
  const t = setup();
  const p = await paidDeal(t, { accept: false });
  assert.throws(() => t.deals.respond({ proposalId: p.id, userId: DEMO_BRAND_ID, accept: true }), { code: 'FORBIDDEN' });
  t.deals.respond({ proposalId: p.id, userId: 'creator_lumen', accept: true });
  assert.throws(() => t.deals.payFee({ proposalId: p.id, userId: 'creator_lumen' }), { code: 'FORBIDDEN' });
});

test('el pago del servicio aplica la comisión del 20%', async () => {
  const t = setup();
  const p = await paidDeal(t);
  assert.equal(p.feeStatus, 'paid_simulated');
  assert.equal(p.feeBreakdown.commission.amount, 500);
  assert.equal(p.feeBreakdown.creatorPayout.amount, 2000);
});

test('contacto protegido antes de aceptar la propuesta', async () => {
  const t = setup();
  const p = await paidDeal(t, { accept: false });
  await t.inda.chat({ proposalId: p.id, senderId: 'creator_lumen', text: 'escríbeme a hola@lumen.example o al +52 55 1111 1111, ig @estudiolumen' });
  const last = t.store.listMessages(p.id).at(-1);
  assert.doesNotMatch(last.text, /lumen\.example|1111|@estudiolumen/);
  assert.equal(last.masked, true);
});

test('maskContact respeta @inda (y el alias @agente)', () => {
  assert.equal(maskContact('@inda arma el kit'), '@inda arma el kit');
  assert.equal(maskContact('@agente arma el kit'), '@agente arma el kit');
});

test('nadie fuera de la propuesta puede escribir en su MatchChat', async () => {
  const t = setup();
  const p = await paidDeal(t);
  await assert.rejects(t.inda.chat({ proposalId: p.id, senderId: 'creator_valeria', text: 'hola' }), { code: 'FORBIDDEN' });
});
