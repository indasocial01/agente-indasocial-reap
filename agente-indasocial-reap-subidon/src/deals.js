// Del match al trato: el asistente convierte el match elegido en una propuesta
// dentro de MatchChat. El estudio/creador la acepta o rechaza, y el fee del
// servicio se cobra por el riel de Indasocial (Stripe Connect) con la comisión.

import { draftTerms } from './agent/skills/matchmaker.js';
import { AgentError } from './agent/errors.js';

export const COMMISSION_RATE = 0.2;

const TYPE_LABEL = { reel: 'reel', post: 'post', story: 'story', video: 'video' };
const PLURAL = { reel: 'reels', post: 'posts', story: 'stories', video: 'videos' };
const delivText = (ds) => ds.map((d) => `${d.count} ${d.count > 1 ? PLURAL[d.type] || d.type : TYPE_LABEL[d.type] || d.type}`).join(' + ');

export function publicProposal(p) {
  if (!p) return p;
  const { creatorShipping, brandEmail, ...pub } = p;
  return pub;
}

export function createDeals({ store }) {
  return {
    // La marca elige uno de los matches que le mostró el asistente.
    selectMatch({ brandId, creatorId }) {
      const brand = store.getUser(brandId);
      const creator = store.getUser(creatorId);
      if (!brand || brand.role !== 'brand') throw new AgentError('FORBIDDEN', 'Solo una marca puede enviar propuestas');
      if (!creator || creator.role !== 'creator') throw new AgentError('NOT_FOUND', 'No existe ese creador');

      const thread = store.getAssistantThread(brandId);
      const shown = thread.messages.some((m) => (m.matches || []).some((x) => x.creator.id === creatorId));
      if (!shown) throw new AgentError('INVALID_STATE', 'Ese creador no está entre tus matches');
      const brief = thread.brief;
      const terms = draftTerms(creator, brief);
      const pillar = brief.pillars.find((p) => creator.pillars.includes(p)) || brief.pillars[0] || creator.pillars[0];

      const proposal = store.saveProposal({
        id: store.newId('prop'),
        title: `Campaña ${pillar.toLowerCase()} · ${delivText(terms.deliverables)}`,
        brandId,
        brandName: brand.name,
        brandEmail: brand.email,
        creatorId,
        creatorName: creator.name,
        pillar,
        deliverables: terms.deliverables,
        fee: terms.fee,
        productionBudget: terms.productionBudget,
        timeline: '2 semanas',
        status: 'sent',
        feeStatus: 'pending',
        creatorEquipment: creator.equipment || [],
        creatorShipping: creator.shipping, // solo servidor: se usa para el envío vía Reap
        createdAt: new Date().toISOString(),
      });

      store.addMessage(proposal.id, {
        from: 'inda',
        kind: 'proposal',
        text: `Propuesta enviada por ${brand.name} a ${creator.name}: ${delivText(terms.deliverables)} por $${terms.fee.amount.toLocaleString('en-US')} USD, más hasta $${terms.productionBudget.amount} USD en insumos de producción. El contacto queda protegido hasta que se acepte.`,
      });
      store.addAssistantMessage(brandId, {
        from: 'asistente',
        text: `Listo, le envié la propuesta a ${creator.name}. La sigues en MatchChat.`,
        proposalId: proposal.id,
      });
      return proposal;
    },

    respond({ proposalId, userId, accept }) {
      const p = store.getProposal(proposalId);
      if (!p) throw new AgentError('PROPOSAL_NOT_FOUND', 'No existe la propuesta');
      if (p.creatorId !== userId) throw new AgentError('FORBIDDEN', 'Solo el creador puede responder la propuesta');
      if (p.status !== 'sent') throw new AgentError('INVALID_STATE', `La propuesta está en ${p.status}`);
      const saved = store.saveProposal({ ...p, status: accept ? 'accepted' : 'declined' });
      store.addMessage(p.id, {
        from: 'inda',
        kind: 'status',
        text: accept
          ? `${p.creatorName} aceptó la propuesta. Siguiente paso: ${p.brandName} paga el servicio en Indasocial.`
          : `${p.creatorName} rechazó la propuesta.`,
      });
      return saved;
    },

    // Simula el cobro del servicio por Stripe Connect con la comisión de Indasocial.
    // En producción: PaymentIntent con application_fee_amount = 20% del fee.
    payFee({ proposalId, userId }) {
      const p = store.getProposal(proposalId);
      if (!p) throw new AgentError('PROPOSAL_NOT_FOUND', 'No existe la propuesta');
      if (p.brandId !== userId) throw new AgentError('FORBIDDEN', 'Solo la marca paga el servicio');
      if (p.status !== 'accepted') throw new AgentError('PROPOSAL_NOT_ACCEPTED', 'Primero el creador debe aceptar');
      if (p.feeStatus !== 'pending') throw new AgentError('INVALID_STATE', 'El servicio ya está pagado');
      const commission = Math.round(p.fee.amount * COMMISSION_RATE * 100) / 100;
      const payout = Math.round((p.fee.amount - commission) * 100) / 100;
      const saved = store.saveProposal({
        ...p,
        feeStatus: 'paid_simulated',
        feeBreakdown: {
          total: p.fee,
          commission: { amount: commission, currency: p.fee.currency },
          creatorPayout: { amount: payout, currency: p.fee.currency },
          rail: 'Stripe Connect (simulado)',
        },
      });
      store.addMessage(p.id, {
        from: 'inda',
        kind: 'status',
        text: `Servicio pagado (simulado): $${p.fee.amount.toLocaleString('en-US')} USD. ${p.creatorName} recibe $${payout.toLocaleString('en-US')} y la comisión de Indasocial es $${commission.toLocaleString('en-US')}. Ahora pueden pedirme el kit de producción con @inda.`,
      });
      return saved;
    },
  };
}
