// Páginas que en producción hospeda Reap (captura de tarjeta y aprobación del cobro).
// Solo existen en modo mock para poder recorrer el flujo completo en local.
import express from 'express';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:14px;max-width:420px;width:100%;padding:24px}
.tag{display:inline-block;font-size:12px;background:#21262d;border:1px solid #30363d;padding:3px 8px;border-radius:99px;color:#71f7ec;margin-bottom:12px}
h1{font-size:20px;margin:0 0 6px}p{color:#9da7b3;font-size:14px;line-height:1.5}
input{width:100%;box-sizing:border-box;margin:6px 0;padding:10px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3}
table{width:100%;font-size:14px;border-collapse:collapse;margin:12px 0}td{padding:6px 0;border-bottom:1px solid #21262d}td:last-child{text-align:right}
.total td{font-weight:700;border:0}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;padding:11px;border-radius:8px;border:0;font-weight:600;cursor:pointer}
.ok{background:#71f7ec;color:#06201e}.no{background:#21262d;color:#e6edf3;border:1px solid #30363d}
</style></head><body><div class="card"><div class="tag">Reap · simulador local</div>${body}</div></body></html>`;

export function mockReapRoutes(reap) {
  const r = express.Router();

  r.get('/enroll/:id', (req, res) => {
    res.send(page('Guardar tarjeta', `
      <h1>Guarda tu tarjeta</h1>
      <p>En producción esta página la hospeda Reap. Indasocial nunca recibe el número de tarjeta.</p>
      <form method="post">
        <input value="4242 4242 4242 4242" aria-label="Número de tarjeta" readonly>
        <input value="12 / 29" aria-label="Vencimiento" readonly>
        <div class="row"><button class="ok" type="submit">Guardar tarjeta de prueba</button></div>
      </form>`));
  });
  r.post('/enroll/:id', (req, res) => {
    const e = reap._activateEnrollment(req.params.id);
    res.redirect(e.returnUrl || '/');
  });

  r.get('/approve/:id', (req, res) => {
    const { checkout, quote } = reap._peekCheckout(req.params.id);
    const b = quote.amountBreakdown;
    const rows = quote.lines.map((l) => `<tr><td>${esc(l.name)}<br><small>${esc(l.merchant)}</small></td><td>$${l.unitPrice.amount.toFixed(2)}</td></tr>`).join('');
    res.send(page('Aprobar cobro', `
      <h1>Aprueba este cobro</h1>
      <p>El Asistente Inda preparó esta compra. No se cobra nada hasta que la apruebes.</p>
      <table>${rows}
        <tr><td>Envío</td><td>$${b.shipping.amount.toFixed(2)}</td></tr>
        <tr><td>Impuestos</td><td>$${b.tax.amount.amount.toFixed(2)}</td></tr>
        <tr class="total"><td>Total</td><td>$${checkout.amount.amount.toFixed(2)} ${esc(checkout.amount.currency)}</td></tr>
      </table>
      <p>Tarjeta VISA •••• 4242</p>
      <form method="post"><div class="row">
        <button class="no" name="decision" value="reject">Rechazar</button>
        <button class="ok" name="decision" value="approve">Aprobar y pagar</button>
      </div></form>`));
  });
  r.post('/approve/:id', (req, res) => {
    const c = reap._decideCheckout(req.params.id, req.body?.decision === 'approve');
    res.redirect(c.returnUrl || '/');
  });

  return r;
}
