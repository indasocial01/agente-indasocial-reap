// Revisión rápida contra el sandbox REAL de Reap (no cobra nada).
// Uso: npm run reap:check
import { loadEnv } from '../src/util/loadEnv.js';
import { createReapClient } from '../src/reap/client.js';
import { demoCreators, demoBrands } from '../src/seed.js';
import { US_DEMO_ADDRESS } from '../src/agent/skills/productionKit.js';

loadEnv();
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const results = [];

if (!process.env.REAP_API_KEY) {
  console.log('✗ No encontré REAP_API_KEY. Pon el archivo reap.env (o .env) en la carpeta del proyecto.');
  process.exit(1);
}
const reap = createReapClient({ mode: 'sandbox' });
const key = process.env.REAP_API_KEY;
const email = process.env.REAP_OWNER_EMAIL || demoBrands()[0].email;
console.log(`Reap sandbox: ${reap.baseUrl} · Reap-Version ${reap.version} · key ${key.slice(0, 10)}…${key.slice(-4)} · correo ${email}\n`);

async function step(name, fn) {
  console.log(`▸ ${name}`);
  try {
    const r = await fn();
    results.push([name, true]);
    return r;
  } catch (e) {
    bad(e.message);
    results.push([name, false, e.code || e.message]);
    return null;
  }
}

// 1) Buscar y quedarnos con productos que cobren en USD (el presupuesto está en USD).
const usd = [];
for (const query of ['photography backdrop', 'fabric', 'linen decor']) {
  await step(`Buscar "${query}"`, async () => {
    const res = await reap.searchProducts({ query, filters: { availability: 'AVAILABLE_ONLY' }, pagination: { limit: 8 } });
    if (!res.products.length) throw new Error('0 productos');
    ok(`${res.products.length} productos`);
    const det = await reap.getProductDetails(res.products.slice(0, 8).map((p) => p.id));
    for (const p of det.products) {
      const v = p.defaultVariant;
      const tag = v.price.currency === 'USD' ? '' : '  (no USD)';
      console.log(`    - ${p.name.slice(0, 60)} · ${p.merchant.name} · ${v.price.amount} ${v.price.currency}${v.available === false ? ' · agotado' : ''}${tag}`);
      if (v.price.currency === 'USD' && v.available !== false) usd.push({ name: p.name, merchant: p.merchant.name, variantId: v.id, price: v.price.amount });
    }
  });
}
usd.sort((a, b) => a.price - b.price);
console.log(`\n  Productos en USD disponibles: ${usd.length}${usd[0] ? ` · el más barato: ${usd[0].name.slice(0, 50)} (${usd[0].merchant}, ${usd[0].price} USD)` : ''}\n`);

// 2) Registrar tarjeta (página de Reap).
await step('Crear registro de tarjeta (página de Reap)', async () => {
  const e = await reap.createEnrollment({
    source: 'EXTERNAL',
    owner: { type: 'CLIENT_REFERENCE', id: 'brand_ecofashion_check', email },
    presentation: { type: 'REDIRECT', returnUrl: 'https://indasocial.com' },
  });
  ok(`registro ${e.id} · estado ${e.status}`);
  if (e.nextAction?.url) console.log(`    página de Reap: ${e.nextAction.url}`);
});

// 3) Cotizar: primero con envío a CDMX; si Reap lo rechaza, probar con dirección de prueba en EE. UU.
const studio = demoCreators().find((c) => c.id === 'creator_lumen');
const tries = usd.slice(0, 3);
let mxOk = false;
let usOk = false;
for (const item of tries) {
  if (mxOk) break;
  const r = await step(`Cotizar "${item.name.slice(0, 40)}" (${item.merchant}) con envío a CDMX, MX`, async () => {
    const q = await reap.createQuote({ items: [{ variantId: item.variantId, quantity: 1 }], email, shippingAddress: studio.shipping });
    ok(`total ${q.amountBreakdown.finalAmount.amount} ${q.amountBreakdown.finalAmount.currency} · envíos: ${q.shippingOptions.map((s) => `${s.name} ${s.price.amount}`).join(', ')}`);
    return q;
  });
  if (r) mxOk = true;
}
if (!mxOk && tries.length) {
  const item = tries[0];
  const r = await step(`Diagnóstico: mismo producto con envío a dirección de prueba en EE. UU.`, async () => {
    const q = await reap.createQuote({ items: [{ variantId: item.variantId, quantity: 1 }], email, shippingAddress: US_DEMO_ADDRESS });
    ok(`total ${q.amountBreakdown.finalAmount.amount} ${q.amountBreakdown.finalAmount.currency}`);
    return q;
  });
  usOk = !!r;
}

console.log('\nResumen:');
for (const [name, pass, why] of results) console.log(`  ${pass ? '✓' : '✗'} ${name}${why ? ` → ${why}` : ''}`);
if (mxOk) console.log('\n→ Envío a México: SÍ. Corre npm start: el demo usa Reap real con envío a CDMX.');
else if (usOk) console.log('\n→ Envío a México: NO en este sandbox, pero a EE. UU. sí.\n  Agrega esta línea a reap.env y corre npm start:\n  REAP_SANDBOX_SHIP_TO=US');
console.log(results.every((r) => r[1]) ? '\nTodo bien.' : '\nCopia este resultado y mándaselo a Claude.');
