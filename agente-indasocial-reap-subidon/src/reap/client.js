// Cliente para Reap Agentic Payments.
// Modo "sandbox": llama al sandbox de Reap (https://sg.sandbox.api.reap.global) con tu API key.
// Documentación: https://docs.reap.global/agentic-payments/overview
// Modo "mock": usa el simulador local (mock.js), útil para probar sin key.
//
// Endpoints usados (docs.reap.global/agentic-payments):
//   POST /agentic/enrollments          guardar tarjeta (página hospedada por Reap)
//   GET  /agentic/enrollments/:id      leer estado (ACTIVE = lista para cobrar)
//   POST /agentic/products/search      buscar en catálogos de comercios
//   POST /agentic/products/details     detalles y variantes
//   POST /agentic/products/variant     resolver variante por opciones
//   POST /agentic/quotes               cotizar (expira pronto)
//   POST /agentic/quotes/:id/shipping-option
//   POST /agentic/checkouts            abrir cobro -> URL de aprobación
//   GET  /agentic/checkouts/:id        estado final, orderId, finalAmount

import { uuid } from '../util/id.js';
import { createMockReap } from './mock.js';

// Reap responde los errores como { error: { code, message, detail } }.
export class ReapError extends Error {
  constructor(status, body) {
    const e = body?.error || body || {};
    const d = e.detail && typeof e.detail === 'object' && Object.keys(e.detail).length ? ` · ${JSON.stringify(e.detail).slice(0, 300)}` : '';
    super(`Reap: ${e.message || e.code || `respondió ${status}`}${e.code ? ` (${e.code})` : ''}${d}`);
    this.status = status;
    this.code = e.code;
    this.detail = e.detail;
    this.body = body;
  }
}

export const DEFAULT_BASE_URL = 'https://sg.sandbox.api.reap.global';
export const DEFAULT_VERSION = '2025-02-14';

const env = typeof process !== 'undefined' && process.env ? process.env : {};

export function createReapClient(opts = {}) {
  const mode = opts.mode || env.REAP_MODE || 'mock';
  if (mode === 'mock') return createMockReap(opts);

  const baseUrl = (opts.baseUrl || env.REAP_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const apiKey = opts.apiKey || env.REAP_API_KEY;
  const version = opts.version || env.REAP_VERSION || DEFAULT_VERSION;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const simulateCheckout = opts.simulateCheckout ?? env.REAP_SIMULATE_CHECKOUT; // solo sandbox
  if (!apiKey) throw new Error('Falta REAP_API_KEY para el modo sandbox');

  async function call(method, path, body, { idempotent = false, extraHeaders = {} } = {}) {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Reap-Version': version,
      ...extraHeaders,
    };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotent) headers['Idempotency-Key'] = uuid();

    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      });
    } catch (err) {
      throw new ReapError(0, { error: { code: 'NETWORK', message: `no pude conectar con ${baseUrl} (${err.message})` } });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { error: { message: text.slice(0, 200) } }; }
    if (!res.ok) throw new ReapError(res.status, json);
    return json;
  }

  return {
    mode,
    baseUrl,
    version,
    createEnrollment: (body) => call('POST', '/agentic/enrollments', body, { idempotent: true }),
    getEnrollment: (id) => call('GET', `/agentic/enrollments/${id}`),
    searchProducts: (body) => call('POST', '/agentic/products/search', body),
    getProductDetails: (productIds) => call('POST', '/agentic/products/details', { productIds }),
    resolveVariant: (productId, optionIds) => call('POST', '/agentic/products/variant', { productId, optionIds }),
    createQuote: (body) => call('POST', '/agentic/quotes', body, { idempotent: true }),
    getQuote: (id) => call('GET', `/agentic/quotes/${id}`),
    selectShippingOption: (quoteId, shippingOptionId) =>
      call('POST', `/agentic/quotes/${quoteId}/shipping-option`, { shippingOptionId }),
    createCheckout: (body) =>
      call('POST', '/agentic/checkouts', body, {
        idempotent: true,
        extraHeaders: simulateCheckout ? { 'X-Simulate-Checkout': simulateCheckout } : {},
      }),
    getCheckout: (id) => call('GET', `/agentic/checkouts/${id}`),
  };
}
