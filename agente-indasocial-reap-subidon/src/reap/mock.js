// Simulador local de Reap Agentic Payments.
// Replica la forma de las respuestas documentadas en docs.reap.global
// para poder probar el flujo completo sin API key ni red.
// Las páginas "hospedadas por Reap" (tarjeta y aprobación) las sirve
// nuestro servidor en /mock-reap/* solo en modo mock.

import { randomHex } from '../util/id.js';

const id = (prefix) => `${prefix}_${randomHex(6)}`;
const money = (amount, currency = 'USD') => ({ amount: Math.round(amount * 100) / 100, currency });

// Catálogo de ejemplo: insumos típicos de producción de contenido.
const CATALOG = [
  { name: 'Aro de luz LED 18" con tripié', merchant: 'StudioGear', price: 49, tags: ['luz', 'iluminacion', 'video', 'reel', 'story', 'tutorial'] },
  { name: 'Micrófono lavalier inalámbrico', merchant: 'AudioHub', price: 39, tags: ['audio', 'microfono', 'video', 'reel', 'tutorial', 'entrevista'] },
  { name: 'Tripié flexible para celular', merchant: 'StudioGear', price: 19, tags: ['tripie', 'video', 'reel', 'story', 'post'] },
  { name: 'Fondo fotográfico de papel color crema', merchant: 'PhotoSupply', price: 29, tags: ['fondo', 'foto', 'post', 'producto', 'moda'] },
  { name: 'Set de props de lino y fibras naturales', merchant: 'EcoProps', price: 34, tags: ['props', 'sostenible', 'moda', 'foto', 'post', 'lifestyle'] },
  { name: 'Tote bag de algodón orgánico (props)', merchant: 'EcoProps', price: 15, tags: ['props', 'sostenible', 'moda', 'lifestyle'] },
  { name: 'Telas recicladas para escenografía (3 m)', merchant: 'EcoProps', price: 22, tags: ['telas', 'escenografia', 'sostenible', 'set', 'fondo'] },
  { name: 'Reflector plegable 5 en 1', merchant: 'PhotoSupply', price: 24, tags: ['luz', 'foto', 'post', 'moda', 'producto'] },
  { name: 'Kit de limpieza de lentes', merchant: 'PhotoSupply', price: 9, tags: ['foto', 'video', 'tech'] },
  { name: 'Soporte de escritorio para cámara cenital', merchant: 'StudioGear', price: 44, tags: ['tutorial', 'producto', 'unboxing', 'tech'] },
];

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function createMockReap({ hostedBaseUrl = '', quoteTtlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const enrollments = new Map();
  const quotes = new Map();
  const checkouts = new Map();
  const products = new Map();

  // IDs fijos del catálogo para que el estado guardado siga siendo válido.
  CATALOG.forEach((p, i) => {
    const productId = `prod_${String(i + 1).padStart(3, '0')}`;
    const variantId = `var_${String(i + 1).padStart(3, '0')}`;
    products.set(productId, {
      id: productId,
      name: p.name,
      merchant: { name: p.merchant },
      tags: p.tags,
      imageUrl: null,
      defaultVariant: { id: variantId, name: 'Estándar', price: money(p.price), available: true, requiresShipping: true },
    });
  });
  const variantIndex = new Map([...products.values()].map((p) => [p.defaultVariant.id, p]));

  function notFound(what) {
    const err = new Error(`${what} no encontrado`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  function badRequest(code, message) {
    const err = new Error(message || code);
    err.status = 400;
    err.code = code;
    throw err;
  }

  return {
    mode: 'mock',

    // Misma forma que POST /agentic/enrollments (source EXTERNAL + owner CLIENT_REFERENCE).
    async createEnrollment({ source = 'EXTERNAL', owner, presentation } = {}) {
      if (!owner?.id || !owner?.email) badRequest('AGENTIC_REQUEST_REJECTED', 'owner.id y owner.email son requeridos');
      if (!presentation?.returnUrl) badRequest('AGENTIC_REQUEST_REJECTED', 'presentation.returnUrl es requerido');
      const e = {
        id: id('enr'),
        source,
        owner: { type: 'CLIENT_REFERENCE', id: owner.id, email: owner.email },
        status: 'REQUIRES_ACTION',
        paymentMethod: null,
        returnUrl: presentation.returnUrl,
        createdAt: new Date(now()).toISOString(),
      };
      enrollments.set(e.id, e);
      return {
        ...e,
        nextAction: { type: 'REDIRECT', url: `${hostedBaseUrl}/mock-reap/enroll/${e.id}` },
      };
    },

    async getEnrollment(enrollmentId) {
      const e = enrollments.get(enrollmentId) || notFound('Enrollment');
      return { ...e };
    },

    async searchProducts({ query = '', context = {}, filters = {}, pagination = {} } = {}) {
      const words = normalize(query).split(/\s+/).filter(Boolean);
      const max = filters?.price?.max != null ? Number(filters.price.max) : Infinity;
      const scored = [...products.values()]
        .map((p) => {
          const hay = normalize(p.name + ' ' + p.tags.join(' '));
          const score = words.filter((w) => hay.includes(w)).length;
          return { p, score };
        })
        .filter(({ p, score }) => score > 0 && p.defaultVariant.price.amount <= max)
        .sort((a, b) => b.score - a.score)
        .slice(0, pagination.limit || 20);
      return {
        id: id('search'),
        products: scored.map(({ p }) => ({
          id: p.id,
          merchant: p.merchant,
          name: p.name,
          imageUrl: p.imageUrl,
          priceRange: { min: p.defaultVariant.price, max: p.defaultVariant.price },
          available: true,
          previewVariant: p.defaultVariant,
        })),
        pagination: { nextCursor: null, hasNextPage: false, returnedCount: scored.length },
        warnings: [],
        context,
      };
    },

    async getProductDetails(productIds = []) {
      const out = [];
      const errors = [];
      for (const pid of productIds) {
        const p = products.get(pid);
        if (!p) errors.push({ productId: pid, code: 'PRODUCT_NOT_FOUND' });
        else out.push({ id: p.id, name: p.name, options: [], defaultVariant: p.defaultVariant, merchant: p.merchant });
      }
      return { products: out, errors };
    },

    async resolveVariant(productId) {
      const p = products.get(productId) || notFound('Producto');
      return { ...p.defaultVariant, options: [] };
    },

    async createQuote({ items, externalCheckout, email, shippingAddress } = {}) {
      if (!!items === !!externalCheckout) badRequest('VALIDATION_ERROR', 'Envía exactamente uno: items o externalCheckout');
      if (externalCheckout) badRequest('CHECKOUT_URL_INVALID', 'externalCheckout requiere un dominio autorizado por Reap');
      if (!shippingAddress) badRequest('VALIDATION_ERROR', 'shippingAddress es requerido para variantes con envío');
      const lines = items.map(({ variantId, quantity = 1 }) => {
        const p = variantIndex.get(variantId);
        if (!p) badRequest('QUOTE_UNFULFILLABLE', `Variante ${variantId} no disponible`);
        return { variantId, quantity, name: p.name, merchant: p.merchant.name, unitPrice: p.defaultVariant.price };
      });
      const merchants = new Set(lines.map((l) => l.merchant));
      if (merchants.size > 1) badRequest('QUOTE_UNFULFILLABLE', 'Una cotización solo puede incluir un comercio');

      const subtotal = lines.reduce((s, l) => s + l.unitPrice.amount * l.quantity, 0);
      const shippingOptions = [
        { id: id('ship'), name: 'Standard', selected: true, price: money(6) },
        { id: id('ship'), name: 'Express', selected: false, price: money(14) },
      ];
      const q = {
        id: id('quo'),
        lines,
        email,
        shippingAddress,
        shippingOptions,
        subtotal,
        expiresAtMs: now() + quoteTtlMs,
      };
      quotes.set(q.id, q);
      return renderQuote(q);
    },

    async getQuote(quoteId) {
      const q = quotes.get(quoteId) || notFound('Quote');
      return renderQuote(q);
    },

    async selectShippingOption(quoteId, shippingOptionId) {
      const q = quotes.get(quoteId) || notFound('Quote');
      if (now() > q.expiresAtMs) badRequest('QUOTE_REPLACEMENT_REQUIRED', 'La cotización expiró');
      if (!q.shippingOptions.some((o) => o.id === shippingOptionId)) badRequest('VALIDATION_ERROR', 'Opción de envío inválida');
      q.shippingOptions.forEach((o) => (o.selected = o.id === shippingOptionId));
      return renderQuote(q);
    },

    async createCheckout({ quoteId, enrollmentId, presentation } = {}) {
      const q = quotes.get(quoteId) || notFound('Quote');
      const e = enrollments.get(enrollmentId) || notFound('Enrollment');
      if (e.status !== 'ACTIVE') badRequest('ENROLLMENT_NOT_ACTIVE', 'El enrollment no está ACTIVE');
      if (now() > q.expiresAtMs) badRequest('QUOTE_EXPIRED', 'La cotización expiró');
      const amount = renderQuote(q).amountBreakdown.finalAmount;
      const c = {
        id: id('chk'),
        status: 'REQUIRES_ACTION',
        quoteId,
        enrollmentId,
        amount,
        returnUrl: presentation?.returnUrl,
        orderId: null,
        finalAmount: null,
        createdAt: new Date(now()).toISOString(),
      };
      c.updatedAt = c.createdAt;
      checkouts.set(c.id, c);
      return {
        ...publicCheckout(c),
        nextAction: { type: 'REDIRECT', url: `${hostedBaseUrl}/mock-reap/approve/${c.id}`, expiresAt: new Date(q.expiresAtMs).toISOString() },
      };
    },

    async getCheckout(checkoutId) {
      const c = checkouts.get(checkoutId) || notFound('Checkout');
      return publicCheckout(c);
    },

    // ---- Controles del simulador (equivalen a lo que el usuario hace en las páginas de Reap) ----
    _activateEnrollment(enrollmentId) {
      const e = enrollments.get(enrollmentId) || notFound('Enrollment');
      e.status = 'ACTIVE';
      e.paymentMethod = { type: 'CARD', network: 'VISA', last4: '4242', expiryMonth: 12, expiryYear: 2029 };
      return { ...e };
    },
    _decideCheckout(checkoutId, approve) {
      const c = checkouts.get(checkoutId) || notFound('Checkout');
      if (c.status !== 'REQUIRES_ACTION') return publicCheckout(c);
      c.status = approve ? 'COMPLETED' : 'CANCELED';
      if (approve) {
        c.orderId = String(10000 + Math.floor(Math.random() * 89999));
        c.finalAmount = c.amount;
      }
      c.updatedAt = new Date(now()).toISOString();
      return { ...publicCheckout(c), returnUrl: c.returnUrl };
    },
    _peekCheckout(checkoutId) {
      const c = checkouts.get(checkoutId) || notFound('Checkout');
      const q = quotes.get(c.quoteId);
      return { checkout: publicCheckout(c), quote: q ? renderQuote(q) : null };
    },
    _peekEnrollment(enrollmentId) {
      const e = enrollments.get(enrollmentId) || notFound('Enrollment');
      return { ...e };
    },

    // Guardar y restaurar el estado (el demo en navegador lo guarda en localStorage).
    exportState() {
      return { enrollments: [...enrollments.values()], quotes: [...quotes.values()], checkouts: [...checkouts.values()] };
    },
    importState(s = {}) {
      enrollments.clear(); quotes.clear(); checkouts.clear();
      (s.enrollments || []).forEach((e) => enrollments.set(e.id, e));
      (s.quotes || []).forEach((q) => quotes.set(q.id, q));
      (s.checkouts || []).forEach((c) => checkouts.set(c.id, c));
    },
  };

  function renderQuote(q) {
    const ship = q.shippingOptions.find((o) => o.selected);
    const tax = Math.round(q.subtotal * 0.08 * 100) / 100;
    const final = q.subtotal + ship.price.amount + tax;
    return {
      id: q.id,
      lines: q.lines,
      shippingOptions: q.shippingOptions.map((o) => ({ ...o })),
      amountBreakdown: {
        itemsSubtotal: money(q.subtotal),
        shipping: ship.price,
        tax: { amount: money(tax), includedInPrices: false },
        discounts: [],
        additionalCharges: [],
        finalAmount: money(final),
      },
      expiresAt: new Date(q.expiresAtMs).toISOString(),
    };
  }

  function publicCheckout(c) {
    const { returnUrl, ...rest } = c;
    return { ...rest, nextAction: null };
  }
}
