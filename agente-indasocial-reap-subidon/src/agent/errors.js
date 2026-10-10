// Errores con código que el backend traduce a respuestas HTTP.
export class AgentError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
