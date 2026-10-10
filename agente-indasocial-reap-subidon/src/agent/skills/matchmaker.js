// Habilidad 1 del Asistente Inda: encontrar el mejor creador o estudio.
// La marca describe lo que necesita en el chat del dashboard; el asistente
// arma un brief, pregunta solo lo que falte y muestra los mejores matches
// con las razones de cada uno.
//
// Reglas:
//   - Puntúa SOLO campos estructurados del perfil (servicios, formatos, ciudad,
//     pilar, rango de precios). La bio y el texto libre nunca cambian el ranking,
//     así un perfil no puede "darle instrucciones" al asistente.
//   - Nunca devuelve datos de contacto.
//   - Si nadie encaja, lo dice: no inventa matches.

import { publicCreator } from '../../seed.js';

const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "2,500" -> 2500 · "2.500" -> 2500 · "150.50" -> 150.5
function toNumber(raw) {
  const s = raw.replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return Number(s.replace(/,/g, ''));
}

const SERVICE_PATTERNS = [
  ['video', /\b(video|videos|reels?|grabaci\w*|filmaci\w*)\b/],
  ['foto', /\b(foto|fotos|fotografi\w*|sesion de fotos|lookbook)\b/],
  ['luz', /\b(luz|luces|iluminaci\w*)\b/],
  ['sonido', /\b(sonido|audio|microfon\w*)\b/],
  ['edicion', /\b(edicion|editar|postproducci\w*)\b/],
];

const FORMAT_PATTERN = /(\d+)\s*(reels?|posts?|stories|historias|videos?|fotos?)\b/g;
const FORMAT_MAP = { reel: 'reel', reels: 'reel', post: 'post', posts: 'post', stories: 'story', historias: 'story', video: 'video', videos: 'video', foto: 'post', fotos: 'post' };

const CITIES = [
  ['CDMX', /\b(cdmx|ciudad de mexico|df)\b/],
  ['Guadalajara', /\bguadalajara\b/],
  ['Monterrey', /\bmonterrey\b/],
  ['Puebla', /\bpuebla\b/],
];

const PILLARS = [
  ['Sostenibilidad', /\b(eco|sostenib\w*|sustentab\w*|circular|reciclad\w*)\b/],
  ['Moda', /\b(moda|coleccion|ropa|fashion)\b/],
  ['Inclusión', /\b(inclusi\w*|accesib\w*|diversidad)\b/],
  ['Innovación', /\b(innovaci\w*|tecnolog\w*|tech|startup)\b/],
];

export function parseBrief(text, prev = {}) {
  const t = norm(text);
  const brief = {
    services: [...(prev.services || [])],
    deliverables: [...(prev.deliverables || [])],
    city: prev.city || null,
    pillars: [...(prev.pillars || [])],
    budget: prev.budget || null,
    productionBudget: prev.productionBudget || null,
    wantsStudio: prev.wantsStudio || false,
  };

  for (const [svc, re] of SERVICE_PATTERNS) if (re.test(t) && !brief.services.includes(svc)) brief.services.push(svc);
  if (/\b(estudio|studio|productora|casa productora)\b/.test(t)) brief.wantsStudio = true;

  for (const m of t.matchAll(FORMAT_PATTERN)) {
    const type = FORMAT_MAP[m[2]];
    const count = Number(m[1]);
    const existing = brief.deliverables.find((d) => d.type === type);
    if (existing) existing.count = count;
    else brief.deliverables.push({ type, count });
    if (['reel', 'video', 'story'].includes(type) && !brief.services.includes('video')) brief.services.push('video');
    if (type === 'post' && !brief.services.length) brief.services.push('foto');
  }

  for (const [city, re] of CITIES) if (re.test(t)) brief.city = city;
  for (const [p, re] of PILLARS) if (re.test(t) && !brief.pillars.includes(p)) brief.pillars.push(p);

  // "$150 para producción" / "150 usd de producción" -> presupuesto de insumos
  const prod = t.match(/\$?\s?([\d][\d,\.]*)\s*(?:usd|dolares)?\s*(?:para|de)\s+(?:la\s+)?producci\w*/);
  if (prod) brief.productionBudget = toNumber(prod[1]);

  // Presupuesto del servicio: el primer monto que no sea el de producción.
  const amounts = [...t.matchAll(/\$\s?([\d][\d,\.]*)|\b([\d][\d,\.]*)\s*(?:usd|dolares)\b|presupuesto\s+(?:de\s+)?\$?\s?([\d][\d,\.]*)/g)]
    .map((m) => toNumber(m[1] || m[2] || m[3]))
    .filter((n) => n > 0 && n !== brief.productionBudget);
  if (amounts.length) brief.budget = amounts[0];

  return brief;
}

// Qué falta para poder recomendar. Se pregunta una sola cosa a la vez.
export function missingQuestion(brief) {
  if (!brief.services.length && !brief.deliverables.length) {
    return '¿Qué necesitas producir? Por ejemplo: "3 reels con luz y sonido" o "sesión de fotos de producto".';
  }
  if (!brief.budget) return '¿Cuál es tu presupuesto para el servicio (en USD)?';
  return null;
}

export function scoreCreator(c, brief) {
  const reasons = [];
  let score = 0;

  if (brief.budget && c.priceRange.min > brief.budget) return { score: 0, reasons: ['Fuera de presupuesto'], excluded: true };

  if (brief.services.length) {
    const covered = brief.services.filter((s) => c.services.includes(s));
    score += (covered.length / brief.services.length) * 40;
    if (covered.length === brief.services.length) reasons.push(`Cubre todo lo que pides: ${covered.join(', ')}`);
    else if (covered.length) reasons.push(`Cubre ${covered.join(', ')} (le falta ${brief.services.filter((s) => !covered.includes(s)).join(', ')})`);
    if (!covered.length) return { score: 0, reasons: ['No ofrece los servicios que pides'], excluded: true };
  }

  const types = brief.deliverables.map((d) => d.type);
  if (types.length) {
    const fmt = types.filter((t) => c.formats.includes(t));
    score += (fmt.length / types.length) * 15;
    if (fmt.length) reasons.push(`Produce ${fmt.join(', ')}`);
  }

  if (brief.city) {
    if (c.city === brief.city) {
      score += 15;
      reasons.push(`Está en ${c.city}`);
    } else score += 3;
  } else score += 8;

  if (brief.pillars.length) {
    const p = brief.pillars.filter((x) => c.pillars.includes(x));
    score += p.length ? 15 : 0;
    if (p.length) reasons.push(`Trabaja ${p.join(' y ').toLowerCase()}`);
  } else score += 8;

  if (brief.budget) {
    score += 15;
    reasons.push(`Precio dentro de tu presupuesto ($${c.priceRange.min.toLocaleString('en-US')}–$${c.priceRange.max.toLocaleString('en-US')})`);
  }

  if (brief.wantsStudio && c.kind === 'studio') score += 5;

  return { score: Math.min(100, Math.round(score)), reasons, excluded: false };
}

export function rankCreators(creators, brief, limit = 3, minScore = 45) {
  return creators
    .map((c) => ({ creator: publicCreator(c), ...scoreCreator(c, brief) }))
    .filter((r) => !r.excluded && r.score >= minScore)
    .sort((a, b) => b.score - a.score || a.creator.priceRange.min - b.creator.priceRange.min)
    .slice(0, limit);
}

// Propuesta que el agente sugiere al elegir un match.
export function draftTerms(creator, brief) {
  const fee = Math.max(creator.priceRange.min, Math.min(brief.budget || creator.priceRange.min, creator.priceRange.max));
  const productionBudget = brief.productionBudget || 150;
  const deliverables = brief.deliverables.length ? brief.deliverables : [{ type: creator.formats[0], count: 1 }];
  return { fee: { amount: fee, currency: 'USD' }, productionBudget: { amount: productionBudget, currency: 'USD' }, deliverables };
}

export function createMatchmaker({ store }) {
  const describe = (brief) => {
    const parts = [];
    const PL = { reel: 'reels', post: 'posts', story: 'stories', video: 'videos' };
    if (brief.deliverables.length) parts.push(brief.deliverables.map((d) => `${d.count} ${d.count > 1 ? PL[d.type] || d.type : d.type}`).join(' + '));
    if (brief.services.length) parts.push(`servicios: ${brief.services.join(', ')}`);
    if (brief.city) parts.push(brief.city);
    if (brief.pillars.length) parts.push(brief.pillars.join(', '));
    if (brief.budget) parts.push(`$${brief.budget.toLocaleString('en-US')} USD`);
    return parts.join(' · ');
  };

  return {
    async handleMessage({ brandId, text }) {
      const brand = store.getUser(brandId);
      if (!brand || brand.role !== 'brand') {
        const err = new Error('Por ahora el asistente busca creadores para marcas');
        err.code = 'FORBIDDEN';
        throw err;
      }
      const thread = store.getAssistantThread(brandId);
      store.addAssistantMessage(brandId, { from: brandId, text });

      const brief = parseBrief(text, thread.brief || {});
      store.saveAssistantBrief(brandId, brief);

      // Registro de lo que hace el agente (se muestra en la interfaz).
      const trace = [`Leí tu mensaje y armé el brief: ${describe(brief) || 'aún incompleto'}`];

      const question = missingQuestion(brief);
      if (question) {
        trace.push('Me falta un dato para buscar bien, así que te pregunto');
        return store.addAssistantMessage(brandId, { from: 'asistente', text: question, brief, trace });
      }

      const all = store.listCreators();
      trace.push(`Revisé ${all.length} perfiles de creadores y estudios (portafolio, servicios, ciudad, pilar y precio)`);
      const scored = all.map((c) => ({ c, ...scoreCreator(c, brief) }));
      const byPrice = scored.filter((s) => s.excluded && s.reasons[0] === 'Fuera de presupuesto');
      const byService = scored.filter((s) => s.excluded && s.reasons[0] !== 'Fuera de presupuesto');
      if (byPrice.length) trace.push(`Descarté ${byPrice.map((s) => s.c.name).join(', ')} por estar fuera de presupuesto`);
      if (byService.length) trace.push(`Descarté ${byService.map((s) => s.c.name).join(', ')} porque no ofrecen lo que pides`);
      trace.push('Ignoré el texto libre de las bios: solo comparo datos del perfil');

      const matches = rankCreators(all, brief);
      if (!matches.length) {
        trace.push('Ningún perfil pasó el mínimo de compatibilidad');
        return store.addAssistantMessage(brandId, {
          from: 'asistente',
          text: `Con este brief (${describe(brief)}) no encontré a nadie que encaje todavía. Puedes ajustar el presupuesto o la ciudad, o publicarlo como campaña para que los creadores se postulen.`,
          brief,
          trace,
        });
      }
      trace.push(`Ordené por compatibilidad: ${matches.map((m) => `${m.creator.name} ${m.score}%`).join(' · ')}`);
      return store.addAssistantMessage(brandId, {
        from: 'asistente',
        text: `Entendí: ${describe(brief)}. Estos son tus mejores matches:`,
        brief,
        trace,
        matches: matches.map((m) => ({ creator: m.creator, score: m.score, reasons: m.reasons })),
      });
    },
  };
}
