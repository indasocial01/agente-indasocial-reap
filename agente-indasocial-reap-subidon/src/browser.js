// Motor del demo para el navegador: corre el mismo backend sin servidor
// y guarda el estado en localStorage. Se compila a public/engine.js (npm run build).
import { createBackend } from './backend.js';

const KEY = 'indasocial-reap-demo-v1';

function createLocalBackend() {
  const backend = createBackend({ mode: 'mock', publicBaseUrl: '', hostedBaseUrl: '' });
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) backend.importState(saved);
  } catch {
    /* sin almacenamiento disponible: el demo funciona en memoria */
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(backend.exportState()));
    } catch {
      /* ignorar */
    }
  };
  return {
    async request(method, path, body, userId) {
      const r = await backend.handle(method, path, { body, userId });
      save(); // algunas lecturas también sincronizan estado (p. ej. el pedido con Reap)
      return r;
    },
    reset() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignorar */
      }
    },
  };
}

globalThis.IndaEngine = { createLocalBackend };
