// Asistente Inda: el único agente de IA de Indasocial.
//
// Acompaña a la marca de principio a fin con dos habilidades:
//   1. Encontrar el match  (skills/matchmaker.js) — en el chat del dashboard.
//   2. Comprar el kit      (skills/productionKit.js) — en MatchChat con "@inda", vía Reap.
//
// Las dos habilidades tienen permisos separados a propósito:
//   - Buscar estudios no toca dinero ni datos de contacto.
//   - Comprar solo se puede con una propuesta aceptada y pagada, dentro del
//     presupuesto, y cada cobro lo aprueba la marca en Reap.

import { createMatchmaker } from './skills/matchmaker.js';
import { createProductionKit, MENTION } from './skills/productionKit.js';

export const AGENT_NAME = 'Asistente Inda';
export { MENTION };

export function createIndaAgent({ reap, store, publicBaseUrl, now }) {
  const match = createMatchmaker({ store });
  const kit = createProductionKit({ reap, store, publicBaseUrl, now });
  return {
    name: AGENT_NAME,
    // Habilidad 1: la marca le escribe en el dashboard.
    findMatches: (args) => match.handleMessage(args),
    // Habilidad 2: MatchChat (si el mensaje menciona @inda, arma el kit con Reap).
    chat: (args) => kit.handleChatMessage(args),
    // Pasos del pago con Reap (tarjeta, aprobación y estado del pedido).
    startCardEnrollment: (args) => kit.startCardEnrollment(args),
    getCardStatus: (args) => kit.getCardStatus(args),
    requestApproval: (args) => kit.requestApproval(args),
    syncOrder: (args) => kit.syncOrder(args),
    planKit: (args) => kit.planKit(args),
  };
}
