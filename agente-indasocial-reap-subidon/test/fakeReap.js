// Reap falso para pruebas: valida cada petición con los esquemas de docs.reap.global
// (Reap-Version 2025-02-14) y responde con la forma documentada.
import assert from 'node:assert/strict';

const UUID = /^[0-9a-f-]{36}$/;

// Opciones basadas en lo que respondió el sandbox real (reap:check del 9-oct-2026):
//   - con context.country=MX la búsqueda sale vacía; sin context, sí hay productos
//   - algunos comercios cobran en GBP
//   - shipsTo: países a los que envían los comercios
export function fakeReap({ shipsTo = ['MX', 'US'] } = {}) {
  const log = [];
  const enrollments = new Map();
  const quotes = new Map();
  const checkouts = new Map();
  const catalog = [
    { id: 'p_retro', name: 'Retro PVC Photography Backdrop Board', merchant: { name: 'bashfashion' }, tags: 'photography backdrop', variant: 'v_retro', price: 12, currency: 'GBP' },
    { id: 'p_backdrop', name: 'Seamless Paper Photography Backdrop', merchant: { name: 'StudioSupply' }, tags: 'photography backdrop', variant: 'v_backdrop', price: 29.5 },
    { id: 'p_fabric', name: 'Recycled Cotton Fabric 3m', merchant: { name: 'EcoMakers' }, tags: 'fabric', variant: 'v_fabric', price: 18 },
    { id: 'p_linen', name: 'Natural Linen Decor Set', merchant: { name: 'EcoMakers' }, tags: 'linen decor', variant: 'v_linen', price: 31 },
  ];
  const money = (amount, currency = 'USD') => ({ amount: Math.round(amount * 100) / 100, currency });
  const fakeEmail = (e) => /\.example$/i.test(e || '');
  const reject = (status, code, message) => new Response(JSON.stringify({ error: { code, message, detail: null } }), { status });
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
  const id = () => crypto.randomUUID();

  async function fetch(url, init) {
    const u = new URL(url);
    const h = init.headers;
    const body = init.body ? JSON.parse(init.body) : null;
    const route = `${init.method} ${u.pathname}`;
    log.push({ route, body, headers: h });
    assert.equal(u.origin, 'https://sg.sandbox.api.reap.global');
    assert.equal(h.Authorization, 'Bearer sk_test');
    assert.equal(h['Reap-Version'], '2025-02-14', route);
    const needsIdem = ['POST /agentic/enrollments', 'POST /agentic/quotes', 'POST /agentic/checkouts'].includes(route);
    if (needsIdem) assert.ok(h['Idempotency-Key'], `Idempotency-Key en ${route}`);

    if (route === 'POST /agentic/enrollments') {
      assert.equal(body.source, 'EXTERNAL');
      assert.deepEqual(Object.keys(body.owner).sort(), ['email', 'id', 'type']);
      assert.equal(body.owner.type, 'CLIENT_REFERENCE');
      assert.match(body.owner.email, /@/);
      if (fakeEmail(body.owner.email)) return reject(400, 'AGENTIC_REQUEST_REJECTED', 'The request was rejected');
      assert.equal(body.presentation.type, 'REDIRECT');
      if (!body.presentation.returnUrl.startsWith('https://')) return reject(400, 'AGENTIC_REQUEST_REJECTED', 'returnUrl must be HTTPS');
      const e = { id: id(), status: 'REQUIRES_ACTION', owner: body.owner, paymentMethod: null, nextAction: { type: 'REDIRECT', url: 'https://sandbox.pay.reap.global/enroll/x', expiresAt: '2026-10-11T00:00:00Z' }, createdAt: 'x', updatedAt: 'x' };
      enrollments.set(e.id, e);
      return ok(e);
    }
    let m;
    if ((m = u.pathname.match(/^\/agentic\/enrollments\/(.+)$/)) && init.method === 'GET') {
      const e = enrollments.get(m[1]);
      return e ? ok(e) : reject(404, 'AGENTIC_RESOURCE_NOT_FOUND', 'not found');
    }
    if (route === 'POST /agentic/products/search') {
      assert.ok(body.query.length > 0);
      // filters es opcional; si viene, price.max es string y availability solo AVAILABLE_ONLY.
      if (body.filters?.price?.max !== undefined) assert.equal(typeof body.filters.price.max, 'string', 'price.max es string');
      if (body.filters?.availability !== undefined) assert.equal(body.filters.availability, 'AVAILABLE_ONLY');
      const max = Number(body.filters?.price?.max ?? Infinity);
      const words = body.query.toLowerCase().split(/\s+/);
      if (body.context?.country === 'MX') return ok({ id: id(), products: [], pagination: { nextCursor: null, hasNextPage: false, returnedCount: 0 }, warnings: [] });
      const products = catalog
        .filter((p) => words.every((w) => p.tags.includes(w)) && p.price <= max)
        // `available` es opcional en la respuesta: aquí no viene.
        .map((p) => ({ id: p.id, merchant: p.merchant, name: p.name, priceRange: { min: money(p.price), max: money(p.price) }, previewVariant: { id: p.variant, price: money(p.price) } }));
      return ok({ id: id(), products, pagination: { nextCursor: null, hasNextPage: false, returnedCount: products.length }, warnings: [] });
    }
    if (route === 'POST /agentic/products/details') {
      assert.ok(Array.isArray(body.productIds) && body.productIds.length <= 10);
      const products = body.productIds.map((pid) => catalog.find((p) => p.id === pid)).map((p) => ({
        id: p.id, merchant: p.merchant, name: p.name, media: [], options: [],
        defaultVariant: { id: p.variant, options: [], price: money(p.price, p.currency), requiresShipping: true, media: [] },
      }));
      return ok({ products, errors: [] });
    }
    if (route === 'POST /agentic/quotes') {
      assert.ok(body.email);
      assert.ok(body.items.length >= 1 && body.items.length <= 20);
      for (const it of body.items) assert.ok(it.variantId && it.quantity > 0);
      const a = body.shippingAddress;
      for (const f of ['firstName', 'lastName', 'phone', 'addressLine1', 'city', 'country']) assert.ok(a[f], `shippingAddress.${f}`);
      assert.match(a.phone, /^\+[1-9]\d{6,14}$/);
      if (fakeEmail(body.email) || !shipsTo.includes(a.country)) return reject(400, 'AGENTIC_REQUEST_REJECTED', 'The request was rejected');
      const subtotal = body.items.reduce((s, it) => s + catalog.find((p) => p.variant === it.variantId).price * it.quantity, 0);
      const q = { id: id(), subtotal, opts: [{ id: 'std', name: 'Standard', price: money(6) }, { id: 'exp', name: 'Express', price: money(15) }], sel: 'exp', expiresAt: '2099-01-01T00:00:00Z' };
      quotes.set(q.id, q);
      return ok(quoteBody(q));
    }
    if ((m = u.pathname.match(/^\/agentic\/quotes\/(.+)\/shipping-option$/))) {
      const q = quotes.get(m[1]);
      q.sel = body.shippingOptionId;
      return ok(quoteBody(q));
    }
    if (route === 'POST /agentic/checkouts') {
      assert.match(body.quoteId, UUID);
      assert.match(body.enrollmentId, UUID);
      if (!body.presentation.returnUrl.startsWith('https://')) return reject(400, 'AGENTIC_REQUEST_REJECTED', 'returnUrl must be HTTPS');
      const e = enrollments.get(body.enrollmentId);
      if (e.status !== 'ACTIVE') return reject(409, 'ENROLLMENT_NOT_ACTIVE', 'Enrollment is not active');
      const q = quotes.get(body.quoteId);
      const c = { id: id(), status: 'REQUIRES_ACTION', quoteId: q.id, enrollmentId: e.id, amount: quoteBody(q).amountBreakdown.finalAmount, nextAction: { type: 'REDIRECT', url: 'https://sandbox.pay.reap.global/approve/y' }, orderId: null };
      checkouts.set(c.id, c);
      return ok(c);
    }
    if ((m = u.pathname.match(/^\/agentic\/checkouts\/(.+)$/))) {
      const c = checkouts.get(m[1]);
      return ok({ id: c.id, status: c.status, quoteId: c.quoteId, enrollmentId: c.enrollmentId, orderId: c.orderId, finalAmount: c.finalAmount, nextAction: c.status === 'REQUIRES_ACTION' ? c.nextAction : null });
    }
    return reject(404, 'AGENTIC_RESOURCE_NOT_FOUND', `no route ${route}`);

    function quoteBody(q) {
      const ship = q.opts.find((o) => o.id === q.sel).price.amount;
      const tax = Math.round(q.subtotal * 0.08 * 100) / 100;
      return {
        id: q.id,
        shippingOptions: q.opts.map((o) => ({ ...o, selected: o.id === q.sel })),
        amountBreakdown: { itemsSubtotal: money(q.subtotal), shipping: money(ship), tax: { amount: money(tax), includedInPrices: false }, discounts: [], additionalCharges: [], finalAmount: money(q.subtotal + ship + tax) },
        expiresAt: q.expiresAt,
      };
    }
  }
  // Lo que hace la marca en las páginas hospedadas por Reap.
  const userCompletesCard = () => { for (const e of enrollments.values()) { e.status = 'ACTIVE'; e.nextAction = null; e.paymentMethod = { type: 'CARD', network: 'VISA', last4: '2058', expiryMonth: 12, expiryYear: 2030 }; } };
  const userApproves = () => { for (const c of checkouts.values()) { c.status = 'COMPLETED'; c.orderId = 'ORD-1001'; c.finalAmount = c.amount; } };
  return { fetch, log, userCompletesCard, userApproves };
}
