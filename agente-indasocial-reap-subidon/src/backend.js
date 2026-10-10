// Backend de Indasocial × Reap sin dependencias de servidor.
// Lo usa Express (src/app.js) y también el navegador (src/browser.js),
// así el demo funciona igual con `npm start`, abierto directo o en hosting estático.

import { createReapClient, ReapError } from './reap/client.js';
import { createMemoryStore } from './store.js';
import { createIndaAgent } from './agent/inda.js';
import { AgentError } from './agent/errors.js';
import { createDeals, publicProposal } from './deals.js';
import { demoBrands, demoCreators, publicCreator, DEMO_BRAND_ID } from './seed.js';

const ERROR_STATUS = {
  PROPOSAL_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  PROPOSAL_NOT_ACCEPTED: 409,
  FEE_PENDING: 409,
  INVALID_STATE: 409,
  CARD_REQUIRED: 409,
  OVER_BUDGET: 422,
  NOTHING_TO_BUY: 422,
  NO_PRODUCTION_BUDGET: 422,
  NO_SHIPPING: 422,
  QUOTE_REJECTED: 422,
};

export function createBackend(opts = {}) {
  const publicBaseUrl = opts.publicBaseUrl ?? 'http://localhost:3000';
  const reap =
    opts.reap ||
    createReapClient({
      mode: opts.mode,
      apiKey: opts.apiKey,
      version: opts.version,
      hostedBaseUrl: opts.hostedBaseUrl ?? publicBaseUrl,
      quoteTtlMs: opts.quoteTtlMs,
      now: opts.now,
    });
  const freshStore = () => createMemoryStore({ brands: demoBrands(), creators: demoCreators(), proposals: opts.proposals || [] });
  let store = opts.store || freshStore();

  // Un solo agente (Asistente Inda) + la lógica de propuestas de la plataforma.
  let inda, deals;
  const wire = () => {
    inda = createIndaAgent({ reap, store, publicBaseUrl, now: opts.now });
    deals = createDeals({ store });
  };
  wire();

  const ok = (body) => ({ status: 200, body });
  const isMock = reap.mode === 'mock';

  // [método, patrón, manejador(params, body, userId, query)]
  const routes = [
    ['GET', /^\/api\/health$/, () => ok({ ok: true, reapMode: reap.mode })],

    ['GET', /^\/api\/demo$/, async () => {
      const proposals = store.listProposalsFor(DEMO_BRAND_ID);
      const current = proposals[proposals.length - 1] || null;
      return ok({
        reapMode: reap.mode,
        brand: store.getUser(DEMO_BRAND_ID),
        creators: store.listCreators().map(publicCreator),
        assistant: store.getAssistantThread(DEMO_BRAND_ID).messages,
        proposal: publicProposal(current),
        chat: current ? store.listMessages(current.id) : [],
        orders: current ? store.listOrdersByProposal(current.id) : [],
        card: await inda.getCardStatus({ brandId: DEMO_BRAND_ID }).catch((e) => ({ status: 'UNKNOWN', error: e.message })),
      });
    }],
    ['POST', /^\/api\/demo\/reset$/, () => {
      store = freshStore();
      if (isMock && reap.importState) reap.importState({});
      wire();
      return ok({ ok: true });
    }],

    // 1) Asistente Inda
    ['POST', /^\/api\/assistant\/messages$/, async (p, body, userId) => {
      const text = String(body?.text || '').slice(0, 1000);
      try {
        return ok(await inda.findMatches({ brandId: userId, text }));
      } catch (e) {
        if (e.code === 'FORBIDDEN') throw new AgentError('FORBIDDEN', e.message);
        throw e;
      }
    }],
    ['POST', /^\/api\/assistant\/matches\/([\w-]+)\/select$/, (p, body, userId) =>
      ok(publicProposal(deals.selectMatch({ brandId: userId, creatorId: p[0] })))],

    // 2) Propuesta en MatchChat
    ['POST', /^\/api\/proposals\/([\w-]+)\/accept$/, (p, b, userId) =>
      ok(publicProposal(deals.respond({ proposalId: p[0], userId, accept: true })))],
    ['POST', /^\/api\/proposals\/([\w-]+)\/decline$/, (p, b, userId) =>
      ok(publicProposal(deals.respond({ proposalId: p[0], userId, accept: false })))],
    ['POST', /^\/api\/proposals\/([\w-]+)\/pay-fee$/, (p, b, userId) =>
      ok(publicProposal(deals.payFee({ proposalId: p[0], userId })))],
    ['POST', /^\/api\/proposals\/([\w-]+)\/chat$/, async (p, body, userId) => {
      const text = String(body?.text || '').slice(0, 1000);
      const result = await inda.chat({ proposalId: p[0], senderId: userId, text });
      return ok(result || { ok: true });
    }],

    // 3) Kit de producción con Reap
    ['POST', /^\/api\/brands\/([\w-]+)\/card$/, async (p, b, userId) => {
      if (userId !== p[0]) throw new AgentError('FORBIDDEN', 'Solo la marca puede registrar su tarjeta');
      return ok(await inda.startCardEnrollment({ brandId: p[0] }));
    }],
    ['GET', /^\/api\/brands\/([\w-]+)\/card$/, async (p) => ok(await inda.getCardStatus({ brandId: p[0] }))],
    ['POST', /^\/api\/kit-orders\/([\w-]+)\/approve$/, async (p, b, userId) =>
      ok(await inda.requestApproval({ orderId: p[0], requestedBy: userId }))],
    ['GET', /^\/api\/kit-orders\/([\w-]+)$/, async (p) => ok(await inda.syncOrder({ orderId: p[0] }))],

    // Simulador de las páginas que hospeda Reap (solo modo mock).
    // El frontend las muestra como una ventana "Reap · simulado".
    ['GET', /^\/api\/sim\/enroll\/([\w-]+)$/, (p) => ok(reap._peekEnrollment(p[0]))],
    ['POST', /^\/api\/sim\/enroll\/([\w-]+)$/, (p) => ok(reap._activateEnrollment(p[0]))],
    ['GET', /^\/api\/sim\/approve\/([\w-]+)$/, (p) => ok(reap._peekCheckout(p[0]))],
    ['POST', /^\/api\/sim\/approve\/([\w-]+)$/, (p, body) => ok(reap._decideCheckout(p[0], body?.approve === true))],
  ];

  async function handle(method, path, { body, userId } = {}) {
    const clean = path.split('?')[0];
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const match = clean.match(re);
      if (!match) continue;
      if (clean.startsWith('/api/sim/') && !isMock) return { status: 404, body: { error: 'NOT_FOUND', message: 'Solo existe en modo simulado' } };
      try {
        return await fn(match.slice(1), body, userId);
      } catch (err) {
        return toError(err);
      }
    }
    return { status: 404, body: { error: 'NOT_FOUND', message: `No existe ${method} ${clean}` } };
  }

  function toError(err) {
    if (err instanceof AgentError) return { status: ERROR_STATUS[err.code] || 400, body: { error: err.code, message: err.message } };
    if (err instanceof ReapError || err.status) {
      const status = err.status >= 400 && err.status < 500 ? err.status : 502;
      return { status, body: { error: err.code || 'REAP_ERROR', message: err.message } };
    }
    if (typeof console !== 'undefined') console.error(err);
    return { status: 500, body: { error: 'INTERNAL', message: 'Error interno' } };
  }

  return {
    handle,
    reap,
    exportState: () => ({ store: store.exportState(), reap: isMock && reap.exportState ? reap.exportState() : null }),
    importState: (s = {}) => {
      if (s.store) store.importState(s.store);
      if (s.reap && isMock && reap.importState) reap.importState(s.reap);
    },
    get inda() { return inda; },
    get deals() { return deals; },
    get store() { return store; },
  };
}
