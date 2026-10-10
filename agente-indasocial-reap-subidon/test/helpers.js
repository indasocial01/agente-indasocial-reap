import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_BRAND_ID } from '../src/seed.js';

export const STUDIO = 'creator_lumen';
const BRIEF = 'Busco un estudio de producción de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD';

export function setup(extra = {}) {
  let clock = Date.parse('2026-10-10T12:00:00Z');
  const now = () => clock;
  const ctx = createApp({ mode: 'mock', publicBaseUrl: 'http://test', now, ...extra });
  return { ctx, inda: ctx.inda, reap: ctx.reap, store: ctx.store, deals: ctx.deals, advance: (ms) => (clock += ms) };
}

// Recorre la historia hasta tener una propuesta aceptada y pagada.
export async function paidDeal(t, { pay = true, accept = true } = {}) {
  await t.inda.findMatches({ brandId: DEMO_BRAND_ID, text: BRIEF });
  const p = t.deals.selectMatch({ brandId: DEMO_BRAND_ID, creatorId: STUDIO });
  if (accept) t.deals.respond({ proposalId: p.id, userId: STUDIO, accept: true });
  if (accept && pay) t.deals.payFee({ proposalId: p.id, userId: DEMO_BRAND_ID });
  return t.store.getProposal(p.id);
}

export async function storeCard(t) {
  const r = await t.inda.startCardEnrollment({ brandId: DEMO_BRAND_ID });
  assert.equal(r.status, 'REQUIRES_ACTION');
  assert.match(r.cardEntryUrl, /\/mock-reap\/enroll\//);
  t.reap._activateEnrollment(r.enrollmentId); // la marca llena la página de Reap
}

