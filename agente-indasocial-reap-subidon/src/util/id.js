// IDs que funcionan igual en Node (>=20) y en el navegador.
const c = globalThis.crypto;

export const randomHex = (bytes) =>
  Array.from(c.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export const uuid = () =>
  typeof c.randomUUID === 'function' ? c.randomUUID() : `${randomHex(4)}-${randomHex(2)}-${randomHex(2)}-${randomHex(2)}-${randomHex(6)}`;
