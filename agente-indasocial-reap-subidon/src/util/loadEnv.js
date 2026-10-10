// Carga variables desde .env y reap.env (si existen). Ninguno de los dos se sube a GitHub.
export function loadEnv() {
  const loaded = [];
  for (const file of ['.env', 'reap.env']) {
    try {
      process.loadEnvFile?.(file);
      loaded.push(file);
    } catch {
      /* no existe: se ignora */
    }
  }
  return loaded;
}
