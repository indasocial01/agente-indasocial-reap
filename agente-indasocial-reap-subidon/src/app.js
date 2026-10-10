// Servidor Express: expone el mismo backend que corre en el navegador.
// Úsalo con `npm start` y, más adelante, con las keys reales de Reap.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './backend.js';
import { mockReapRoutes } from './mockPages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(opts = {}) {
  const publicBaseUrl = opts.publicBaseUrl || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const backend = createBackend({ ...opts, publicBaseUrl });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // En Indasocial, el usuario sale del JWT de Supabase Auth.
  // En el prototipo lo simulamos con el header x-user-id.
  app.all('/api/*', async (req, res) => {
    const r = await backend.handle(req.method, req.originalUrl, { body: req.body, userId: req.get('x-user-id') });
    res.status(r.status).json(r.body);
  });

  // Regresos desde las páginas reales de Reap (modo sandbox)
  app.get('/reap/return', async (req, res) => {
    if (req.query.order) await backend.handle('GET', `/api/kit-orders/${encodeURIComponent(String(req.query.order))}`);
    res.redirect(`/?order=${encodeURIComponent(req.query.order || '')}`);
  });
  app.get('/reap/enrollment-return', (req, res) => res.redirect('/?card=1'));

  if (backend.reap.mode === 'mock') app.use('/mock-reap', mockReapRoutes(backend.reap));

  // no-cache: así el navegador nunca se queda con una versión vieja del demo.
  app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  return {
    app,
    backend,
    reap: backend.reap,
    get inda() { return backend.inda; },
    get deals() { return backend.deals; },
    get store() { return backend.store; },
  };
}
