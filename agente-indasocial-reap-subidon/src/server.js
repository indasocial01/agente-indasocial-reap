// Las keys viven en .env o reap.env en local; en Vercel van en Environment Variables.
import { loadEnv } from './util/loadEnv.js';

const loaded = loadEnv();
const { createApp } = await import('./app.js');

const port = Number(process.env.PORT || 3000);
const { app, reap } = createApp({ publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}` });

app.listen(port, () => {
  const mode = reap.mode === 'mock' ? 'simulado' : `sandbox real (${reap.baseUrl})`;
  console.log(`Indasocial × Reap listo en http://localhost:${port} (Reap: ${mode})${loaded.length ? ` · leí ${loaded.join(' y ')}` : ''}`);
});
