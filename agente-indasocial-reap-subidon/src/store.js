// Almacenamiento en memoria para el prototipo.
// En producción esto vive en Supabase (ver sql/001_campaign_kit.sql).
// La interfaz es pequeña a propósito para que cambiarla sea directo.
// exportState/importState permiten guardar el demo en el navegador.

import { randomHex, uuid } from './util/id.js';

export function createMemoryStore(seed = {}) {
  const users = new Map([...(seed.brands || []), ...(seed.creators || [])].map((u) => [u.id, u]));
  const proposals = new Map((seed.proposals || []).map((p) => [p.id, p]));
  const enrollments = new Map(); // brandId -> { enrollmentId, status }
  const plans = new Map();
  const orders = new Map();
  const messages = new Map(); // proposalId -> [...]
  const assistant = new Map(); // brandId -> { brief, messages: [...] }

  const stamp = (msg) => ({ id: uuid(), at: new Date().toISOString(), ...msg });

  return {
    newId: (prefix) => `${prefix}_${randomHex(5)}`,

    getUser: (id) => users.get(id) || null,
    listCreators: () => [...users.values()].filter((u) => u.role === 'creator'),

    getProposal: (id) => proposals.get(id) || null,
    saveProposal: (p) => proposals.set(p.id, { ...p, updatedAt: new Date().toISOString() }) && proposals.get(p.id),
    listProposalsFor: (userId) => [...proposals.values()].filter((p) => p.brandId === userId || p.creatorId === userId),

    getBrandEnrollment: (brandId) => enrollments.get(brandId) || null,
    saveBrandEnrollment: (brandId, data) => enrollments.set(brandId, { ...data, brandId }) && enrollments.get(brandId),

    getPlan: (id) => plans.get(id) || null,
    savePlan: (plan) => plans.set(plan.id, plan) && plan,

    getOrder: (id) => orders.get(id) || null,
    saveOrder: (order) => orders.set(order.id, { ...order, updatedAt: new Date().toISOString() }) && orders.get(order.id),
    listOrdersByPlan: (planId) => [...orders.values()].filter((o) => o.planId === planId),
    listOrdersByProposal: (proposalId) => [...orders.values()].filter((o) => o.proposalId === proposalId),

    addMessage: (proposalId, msg) => {
      const list = messages.get(proposalId) || [];
      const full = stamp(msg);
      list.push(full);
      messages.set(proposalId, list);
      return full;
    },
    listMessages: (proposalId) => messages.get(proposalId) || [],

    getAssistantThread: (brandId) => assistant.get(brandId) || { brief: null, messages: [] },
    saveAssistantBrief: (brandId, brief) => {
      const t = assistant.get(brandId) || { brief: null, messages: [] };
      t.brief = brief;
      assistant.set(brandId, t);
    },
    addAssistantMessage: (brandId, msg) => {
      const t = assistant.get(brandId) || { brief: null, messages: [] };
      const full = stamp(msg);
      t.messages.push(full);
      assistant.set(brandId, t);
      return full;
    },

    exportState: () => ({
      proposals: [...proposals.entries()],
      enrollments: [...enrollments.entries()],
      plans: [...plans.entries()],
      orders: [...orders.entries()],
      messages: [...messages.entries()],
      assistant: [...assistant.entries()],
    }),
    importState: (s = {}) => {
      const load = (map, entries) => {
        map.clear();
        (entries || []).forEach(([k, v]) => map.set(k, v));
      };
      load(proposals, s.proposals);
      load(enrollments, s.enrollments);
      load(plans, s.plans);
      load(orders, s.orders);
      load(messages, s.messages);
      load(assistant, s.assistant);
    },
  };
}
