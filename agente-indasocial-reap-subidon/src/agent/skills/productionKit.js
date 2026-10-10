// Habilidad 2 del Asistente Inda: comprar el kit de producción con Reap Agentic Payments.
//
// Qué hace:
//   1. Cuando una propuesta de servicio ya fue ACEPTADA y PAGADA en MatchChat,
//      la marca escribe "@inda ..." y le pide al asistente los insumos físicos.
//   2. El asistente busca en los catálogos de Reap, arma un plan dentro del
//      presupuesto de producción de la propuesta y cotiza con envío al creador.
//   3. Cada cobro lo aprueba la marca en la página hospedada por Reap.
//      Indasocial nunca ve ni guarda el número de tarjeta.
//
// Reglas que el asistente no puede romper (se validan en servidor):
//   - Solo propuestas con status "accepted".
//   - Solo la marca dueña de la propuesta puede pedir, aprobar o cancelar.
//   - La suma de pedidos nunca supera productionBudget.
//   - Ningún cobro sin aprobación explícita de la marca en Reap.

import { deriveNeeds } from './needs.js';
import { AgentError } from '../errors.js';

export { AgentError };

// Cómo se llama al asistente en MatchChat. "@agente" queda como alias.
export const MENTION = /@(inda|agente)\b/i;

const ACTIVE_ORDER_STATUSES = new Set(['AWAITING_APPROVAL', 'COMPLETED']);

export function maskContact(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[contacto oculto]')
    .replace(/(?<![\w@])@[a-z0-9_.]{3,}/gi, (m) => (/^@(inda|agente)$/i.test(m) ? m : '[contacto oculto]'))
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[contacto oculto]');
}

const joinEs = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`);

// Reap pide returnUrl HTTPS. En local (http://localhost) intentamos primero con
// la URL local y, si Reap la rechaza, usamos esta página HTTPS: la app no depende
// del regreso porque consulta el estado sola.
const FALLBACK_RETURN_URL = 'https://indasocial.com';

// Solo sandbox y solo si se activa con REAP_SANDBOX_SHIP_TO=US: algunos comercios del
// sandbox no envían a México, así que la demo puede cotizar con esta dirección de prueba.
export const US_DEMO_ADDRESS = {
  firstName: 'Estudio',
  lastName: 'Lumen',
  phone: '+12125550123',
  addressLine1: '350 5th Ave',
  city: 'New York',
  region: 'NY',
  postalCode: '10118',
  country: 'US',
};
const env = typeof process !== 'undefined' && process.env ? process.env : {};

export function createProductionKit({ reap, store, publicBaseUrl, maxItems = 4, now = () => Date.now() }) {
  const sandbox = reap.mode !== 'mock';
  const fallbackReturnUrl = env.REAP_FALLBACK_RETURN_URL || FALLBACK_RETURN_URL;
  const shipToUS = sandbox && String(env.REAP_SANDBOX_SHIP_TO || '').toUpperCase() === 'US';
  const shippingFor = (proposal) => (shipToUS ? US_DEMO_ADDRESS : proposal.creatorShipping);

  async function withReturnUrl(path, send) {
    const primary = `${publicBaseUrl}${path}`;
    try {
      return await send(primary);
    } catch (err) {
      const rejected = err.status === 400 && !primary.startsWith('https://');
      if (!rejected) throw err;
      return send(fallbackReturnUrl);
    }
  }

  // El catálogo real de Reap está en inglés; el simulador, en español.
  async function search(need, remaining, proposal, currency) {
    const base = {
      filters: { price: { max: String(Math.floor(remaining * 100) / 100) }, availability: 'AVAILABLE_ONLY' },
      pagination: { limit: 5 },
    };
    const queries = sandbox && need.queryEn ? [need.queryEn, need.query] : [need.query];
    for (const query of queries) {
      const res = await reap.searchProducts({ ...base, query, context: { country: shippingFor(proposal).country, currency } });
      if (res.products?.length) return { res, query };
      if (sandbox) {
        const wide = await reap.searchProducts({ ...base, query });
        if (wide.products?.length) return { res: wide, query };
      }
    }
    return { res: { products: [] }, query: queries[0] };
  }

  function getAcceptedProposal(proposalId, requestedBy) {
    const p = store.getProposal(proposalId);
    if (!p) throw new AgentError('PROPOSAL_NOT_FOUND', 'No existe la propuesta');
    if (p.brandId !== requestedBy) throw new AgentError('FORBIDDEN', 'Solo la marca de la propuesta puede pedirle compras al asistente');
    if (p.status !== 'accepted') throw new AgentError('PROPOSAL_NOT_ACCEPTED', 'El asistente solo compra para propuestas aceptadas');
    if (p.feeStatus === 'pending') throw new AgentError('FEE_PENDING', 'Primero hay que pagar el servicio en Indasocial');
    if (!p.productionBudget?.amount) throw new AgentError('NO_PRODUCTION_BUDGET', 'La propuesta no tiene presupuesto de producción');
    if (!p.creatorShipping) throw new AgentError('NO_SHIPPING', 'Falta la dirección de envío del creador');
    return p;
  }

  function committedSpend(planId) {
    return store
      .listOrdersByPlan(planId)
      .filter((o) => ACTIVE_ORDER_STATUSES.has(o.status))
      .reduce((s, o) => s + (o.finalAmount?.amount ?? o.amount.amount), 0);
  }

  // Cotiza por comercio. Si un comercio rechaza la cotización (p. ej. no envía a ese
  // país) se omite ese comercio y se sigue con los demás; `notes` explica qué pasó.
  async function quoteItems(items, proposal, notes = [], currency = 'USD') {
    const byMerchant = new Map();
    for (const it of items) {
      const list = byMerchant.get(it.merchant) || [];
      list.push(it);
      byMerchant.set(it.merchant, list);
    }
    const quoted = [];
    let lastError = null;
    for (const [merchant, group] of byMerchant) {
      try {
        let quote = await reap.createQuote({
          items: group.map((g) => ({ variantId: g.variantId, quantity: 1 })),
          email: proposal.brandEmail,
          shippingAddress: shippingFor(proposal),
        });
        const cheapest = [...quote.shippingOptions].sort((a, b) => a.price.amount - b.price.amount)[0];
        if (cheapest && !cheapest.selected) quote = await reap.selectShippingOption(quote.id, cheapest.id);
        if (quote.amountBreakdown.finalAmount.currency !== currency) {
          notes.push(`Reap · ${merchant} cotizó en ${quote.amountBreakdown.finalAmount.currency}; lo omito porque el presupuesto está en ${currency}`);
          continue;
        }
        quoted.push({ merchant, items: group, quote });
      } catch (err) {
        if (!err.status) throw err;
        lastError = err;
        notes.push(`Reap · ${merchant} no pudo cotizar el envío (${err.code || err.status}); lo omito`);
      }
    }
    if (!quoted.length && lastError) throw new AgentError('QUOTE_REJECTED', `Ningún comercio pudo cotizar con envío. ${lastError.message}`);
    return quoted;
  }

  const total = (quoted) => quoted.reduce((s, q) => s + q.quote.amountBreakdown.finalAmount.amount, 0);

  return {
    // Paso 0: la marca guarda su tarjeta una sola vez (página hospedada por Reap).
    async startCardEnrollment({ brandId }) {
      const existing = store.getBrandEnrollment(brandId);
      if (existing?.enrollmentId) {
        const e = await reap.getEnrollment(existing.enrollmentId);
        if (e.status === 'ACTIVE') return { status: 'ACTIVE', enrollmentId: e.id };
      }
      const brand = store.getUser(brandId);
      const e = await withReturnUrl(`/reap/enrollment-return?brand=${encodeURIComponent(brandId)}`, (returnUrl) =>
        reap.createEnrollment({
          source: 'EXTERNAL',
          owner: { type: 'CLIENT_REFERENCE', id: brandId, email: env.REAP_OWNER_EMAIL || brand?.email },
          presentation: { type: 'REDIRECT', returnUrl },
        })
      );
      store.saveBrandEnrollment(brandId, { enrollmentId: e.id, status: e.status });
      return { status: e.status, enrollmentId: e.id, cardEntryUrl: e.nextAction?.url };
    },

    async getCardStatus({ brandId }) {
      const saved = store.getBrandEnrollment(brandId);
      if (!saved) return { status: 'NONE' };
      const e = await reap.getEnrollment(saved.enrollmentId);
      store.saveBrandEnrollment(brandId, { enrollmentId: e.id, status: e.status });
      const pm = e.paymentMethod;
      return { status: e.status, enrollmentId: e.id, card: pm ? { brand: pm.network, last4: pm.last4 } : null };
    },

    // Paso 1: armar el plan de insumos dentro del presupuesto.
    async planKit({ proposalId, requestedBy, message = '' }) {
      const proposal = getAcceptedProposal(proposalId, requestedBy);
      const budget = proposal.productionBudget.amount;
      const currency = proposal.productionBudget.currency || 'USD';
      const { queries: needs, skipped } = deriveNeeds(proposal, message, proposal.creatorEquipment || []);
      if (!needs.length) throw new AgentError('NOTHING_TO_BUY', 'No encontré insumos que correspondan a esta propuesta');

      // Registro de lo que hace el asistente (se muestra en MatchChat).
      const trace = [
        `Revisé la propuesta aceptada y pagada: presupuesto de producción $${budget} ${currency}`,
      ];
      if (skipped.length) trace.push(`Revisé el equipo del estudio: ya tiene ${joinEs(skipped.map((s) => s.label))}, así que no lo compro`);

      const chosen = [];
      let estimate = 0;
      for (const need of needs) {
        if (chosen.length >= maxItems) break;
        const remaining = budget - estimate;
        if (remaining <= 0) break;
        const { res, query } = await search(need, remaining, proposal, currency);
        const candidates = res.products.filter((p) => p.available !== false && !chosen.some((c) => c.productId === p.id)).slice(0, 8);
        // Detalles de varios a la vez: se elige el primero disponible, en la moneda del presupuesto y que quepa.
        const details = candidates.length ? await reap.getProductDetails(candidates.map((p) => p.id)) : { products: [] };
        let hit = null;
        let variant = null;
        let otherCurrency = null;
        for (const p of candidates) {
          const v = details.products?.find((d) => d.id === p.id)?.defaultVariant;
          if (!v || v.available === false) continue;
          if (v.price.currency !== currency) { otherCurrency = otherCurrency || v.price.currency; continue; }
          if (v.price.amount > remaining) continue;
          hit = p;
          variant = v;
          break;
        }
        if (!hit) {
          trace.push(`Reap · busqué "${query}": nada disponible${otherCurrency ? ` en ${currency} (había en ${otherCurrency})` : ''} dentro de lo que queda`);
          continue;
        }
        trace.push(`Reap · busqué "${query}" → ${hit.name} (${hit.merchant.name}, $${variant.price.amount.toFixed(2)})`);
        estimate += variant.price.amount;
        chosen.push({
          productId: hit.id,
          variantId: variant.id,
          name: hit.name,
          merchant: hit.merchant.name,
          price: variant.price,
          reason: need.source,
        });
      }
      if (!chosen.length) throw new AgentError('NOTHING_TO_BUY', 'No hay insumos disponibles dentro del presupuesto');

      // Cotizar y recortar desde lo menos prioritario hasta caber en el presupuesto
      // (envío e impuestos solo se conocen al cotizar).
      if (shipToUS) trace.push('Sandbox: cotizo con una dirección de prueba en EE. UU. porque estos comercios no envían a México');
      let items = chosen;
      const notes = [];
      let quoted = await quoteItems(items, proposal, notes, currency);
      while (total(quoted) > budget && items.length > 1) {
        trace.push(`Con envío e impuestos daba $${total(quoted).toFixed(2)}: quité ${items[items.length - 1].name} para no pasarme de $${budget}`);
        items = items.slice(0, -1);
        quoted = await quoteItems(items, proposal, notes, currency);
      }
      trace.push(...new Set(notes));
      if (!quoted.length) throw new AgentError('NOTHING_TO_BUY', 'Ningún comercio pudo cotizar en la moneda del presupuesto');
      if (total(quoted) > budget) {
        throw new AgentError('OVER_BUDGET', 'Ni el insumo más prioritario cabe en el presupuesto con envío e impuestos');
      }
      for (const q of quoted) {
        trace.push(`Reap · coticé con ${q.merchant} con envío a ${shippingFor(proposal).city || 'el estudio'} y elegí el envío más barato: $${q.quote.amountBreakdown.finalAmount.amount.toFixed(2)}`);
      }
      trace.push(`Total $${total(quoted).toFixed(2)} de $${budget}. No cobro nada: la marca aprueba cada pedido en Reap`);

      const plan = store.savePlan({
        id: store.newId('plan'),
        proposalId,
        brandId: proposal.brandId,
        creatorId: proposal.creatorId,
        budget: proposal.productionBudget,
        request: message,
        createdAt: new Date(now()).toISOString(),
      });
      const orders = quoted.map((q) =>
        store.saveOrder({
          id: store.newId('kit'),
          planId: plan.id,
          proposalId,
          brandId: proposal.brandId,
          merchant: q.merchant,
          items: q.items,
          quoteId: q.quote.id,
          amount: q.quote.amountBreakdown.finalAmount,
          breakdown: q.quote.amountBreakdown,
          quoteExpiresAt: q.quote.expiresAt,
          status: 'QUOTED',
        })
      );
      return { plan, orders, total: { amount: total(quoted), currency }, dropped: chosen.length - items.length, skipped, trace };
    },

    // Paso 2: la marca acepta un pedido -> checkout -> URL de aprobación en Reap.
    async requestApproval({ orderId, requestedBy }) {
      const order = store.getOrder(orderId);
      if (!order) throw new AgentError('ORDER_NOT_FOUND', 'No existe el pedido');
      const proposal = getAcceptedProposal(order.proposalId, requestedBy);
      if (order.status !== 'QUOTED') throw new AgentError('INVALID_STATE', `El pedido está en ${order.status}`);

      const enr = store.getBrandEnrollment(proposal.brandId);
      const enrollment = enr ? await reap.getEnrollment(enr.enrollmentId) : null;
      if (enrollment?.status !== 'ACTIVE') {
        throw new AgentError('CARD_REQUIRED', 'La marca necesita guardar una tarjeta en Reap primero');
      }

      // Si la cotización expiró, re-cotizar los mismos artículos.
      let { quoteId, amount, breakdown, quoteExpiresAt } = order;
      if (now() >= Date.parse(quoteExpiresAt)) {
        const [fresh] = await quoteItems(order.items, proposal, [], order.amount.currency);
        if (!fresh) throw new AgentError('QUOTE_REJECTED', 'No pude volver a cotizar este pedido');
        quoteId = fresh.quote.id;
        amount = fresh.quote.amountBreakdown.finalAmount;
        breakdown = fresh.quote.amountBreakdown;
        quoteExpiresAt = fresh.quote.expiresAt;
      }

      const plan = store.getPlan(order.planId);
      if (committedSpend(order.planId) + amount.amount > plan.budget.amount) {
        throw new AgentError('OVER_BUDGET', 'Este pedido rebasa el presupuesto de producción restante');
      }

      const checkout = await withReturnUrl(`/reap/return?order=${order.id}`, (returnUrl) =>
        reap.createCheckout({ quoteId, enrollmentId: enrollment.id, presentation: { type: 'REDIRECT', returnUrl } })
      );

      const saved = store.saveOrder({
        ...order,
        quoteId,
        amount,
        breakdown,
        quoteExpiresAt,
        checkoutId: checkout.id,
        approvalUrl: checkout.nextAction?.url || null,
        status: checkout.nextAction ? 'AWAITING_APPROVAL' : 'PROCESSING',
      });
      return checkout.nextAction ? saved : this.syncOrder({ orderId: saved.id });
    },

    // Paso 3: al volver de Reap (o por polling), leer el estado final.
    async syncOrder({ orderId }) {
      const order = store.getOrder(orderId);
      if (!order) throw new AgentError('ORDER_NOT_FOUND', 'No existe el pedido');
      if (!order.checkoutId) return order;
      const c = await reap.getCheckout(order.checkoutId);
      const update = { ...order, reapStatus: c.status };
      if (c.status === 'COMPLETED') {
        update.status = 'COMPLETED';
        update.reapOrderId = c.orderId;
        update.finalAmount = c.finalAmount;
        // Conciliar contra lo realmente cobrado, no contra la cotización.
        if (c.finalAmount && c.finalAmount.amount > order.amount.amount) update.flag = 'AMOUNT_HIGHER_THAN_QUOTE';
      } else if (['CANCELED', 'FAILED', 'EXPIRED', 'DECLINED'].includes(c.status)) {
        update.status = c.status;
      }
      return store.saveOrder(update);
    },

    // Integración con MatchChat: cualquiera de las dos partes escribe;
    // la marca puede llamar al asistente con "@inda ...".
    async handleChatMessage({ proposalId, senderId, text }) {
      const proposal = store.getProposal(proposalId);
      if (!proposal) throw new AgentError('PROPOSAL_NOT_FOUND', 'No existe la propuesta');
      if (![proposal.brandId, proposal.creatorId].includes(senderId)) {
        throw new AgentError('FORBIDDEN', 'Solo la marca y el creador de la propuesta pueden escribir aquí');
      }
      // Contacto protegido: antes de aceptar la propuesta se ocultan correos, teléfonos y @usuarios.
      const clean = proposal.status === 'accepted' ? text : maskContact(text);
      store.addMessage(proposalId, { from: senderId, text: clean, masked: clean !== text });
      if (!MENTION.test(text)) return null;
      try {
        const result = await this.planKit({ proposalId, requestedBy: senderId, message: text });
        const lines = result.orders.map(
          (o) => `• ${o.merchant}: ${o.items.map((i) => i.name).join(', ')} — ${o.amount.amount.toFixed(2)} ${o.amount.currency}`
        );
        const reply = [
          result.skipped.length
            ? `${proposal.creatorName} ya tiene ${joinEs(result.skipped.map((s) => s.label))}, así que no lo compré.`
            : null,
          `Armé el kit de producción con envío a ${proposal.creatorName} (${result.total.amount.toFixed(2)} ${result.total.currency} de ${result.plan.budget.amount} ${result.plan.budget.currency} disponibles):`,
          ...lines,
          result.dropped ? `Dejé fuera ${result.dropped} artículo(s) para no pasarme del presupuesto.` : null,
          'Cada pedido se paga solo cuando la marca lo aprueba en Reap.',
        ]
          .filter(Boolean)
          .join('\n');
        store.addMessage(proposalId, { from: 'inda', text: reply, trace: result.trace, planId: result.plan.id, orderIds: result.orders.map((o) => o.id) });
        return { reply, ...result };
      } catch (err) {
        const reply = `No pude armar el kit: ${err.message}.`;
        store.addMessage(proposalId, { from: 'inda', text: reply, error: err.code });
        return { reply, error: err.code };
      }
    },
  };
}
