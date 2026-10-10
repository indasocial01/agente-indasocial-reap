// Traduce una propuesta aceptada (y el mensaje de la marca en MatchChat)
// en una lista priorizada de insumos de producción a buscar en Reap.
// Es determinista a propósito: el agente nunca decide gastar fuera de lo
// que la propuesta y la marca piden, y no necesita ningún dato de tarjeta.
// Omite lo que el creador/estudio ya tiene en su equipo.
// `queryEn` se usa con el catálogo real de Reap (en inglés); `query`, con el simulador.

const NEEDS = {
  luz: { query: 'aro luz video', queryEn: 'ring light', covers: 'luz', label: 'luz' },
  audio: { query: 'microfono audio', queryEn: 'microphone', covers: 'audio', label: 'audio' },
  tripie: { query: 'tripie video', queryEn: 'tripod', covers: 'tripie', label: 'tripié' },
  reflector: { query: 'reflector foto', queryEn: 'photo reflector', covers: 'luz', label: 'reflector' },
  cenital: { query: 'soporte cenital', queryEn: 'overhead camera mount', covers: 'cenital', label: 'soporte cenital' },
  fondo: { query: 'fondo foto', queryEn: 'photography backdrop', covers: 'fondo', label: 'fondo fotográfico' },
  props: { query: 'props', queryEn: 'decor props', covers: null, label: 'props' },
  propsEco: { query: 'props sostenible', queryEn: 'linen decor', covers: null, label: 'props sostenibles' },
  telas: { query: 'telas escenografia', queryEn: 'fabric', covers: null, label: 'telas para escenografía' },
};

const DELIVERABLE_NEEDS = {
  reel: ['luz', 'audio', 'tripie'],
  video: ['luz', 'audio', 'tripie'],
  story: ['tripie', 'luz'],
  post: ['fondo', 'reflector'],
  tutorial: ['cenital', 'audio', 'luz'],
};

const PILLAR_NEEDS = {
  sostenibilidad: ['propsEco', 'telas'],
  moda: ['props', 'fondo'],
  inclusion: [],
  innovacion: ['cenital'],
};

const KEYWORDS = [
  [/\b(luz|luces|ilumina\w*|aro)\b/i, ['luz']],
  [/\b(micro\w*|audio|sonido)\b/i, ['audio']],
  [/\b(tripi[eé]|tripod\w*)\b/i, ['tripie']],
  [/\b(fondo|backdrop)\b/i, ['fondo']],
  [/\b(escenograf\w*|set)\b/i, ['telas', 'fondo']],
  [/\b(props?|utiler[ií]a|decoraci[oó]n)\b/i, ['props']],
  [/\b(sosten\w*|eco|reciclad\w*)\b/i, ['propsEco']],
  [/\b(reflector\w*)\b/i, ['reflector']],
  [/\b(cenital|overhead)\b/i, ['cenital']],
];

const norm = (p = '') => p.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function deriveNeeds(proposal, brandMessage = '', creatorEquipment = []) {
  const queries = [];
  const skipped = [];
  const add = (key, source) => {
    const need = NEEDS[key];
    if (!need || queries.some((q) => q.key === key) || skipped.some((s) => s.key === key)) return;
    if (need.covers && creatorEquipment.includes(need.covers)) skipped.push({ key, label: need.label, source });
    else queries.push({ key, query: need.query, queryEn: need.queryEn, label: need.label, source });
  };

  // 1) Lo que la marca pidió explícitamente en el chat tiene prioridad.
  for (const [re, keys] of KEYWORDS) if (re.test(brandMessage)) keys.forEach((k) => add(k, 'chat'));
  // "props sostenibles" ya cubre "props"
  if (queries.some((q) => q.key === 'propsEco')) {
    const i = queries.findIndex((q) => q.key === 'props');
    if (i >= 0) queries.splice(i, 1);
  }

  // 2) Lo que exigen los entregables de la propuesta.
  for (const d of proposal.deliverables || []) for (const k of DELIVERABLE_NEEDS[d.type] || []) add(k, `entregable:${d.type}`);

  // 3) El pilar de la campaña.
  for (const k of PILLAR_NEEDS[norm(proposal.pillar)] || []) add(k, `pilar:${proposal.pillar}`);

  return { queries, skipped };
}
