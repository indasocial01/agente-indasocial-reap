# Agente Indasocial × Reap

**Asistente Inda: un agente de IA que encuentra el estudio ideal para tu marca y compra los insumos de la campaña con Reap Agentic Payments, siempre con tu aprobación.**

Proyecto para el **Reap x AIBM Agentic Buildathon** · [Indasocial](https://indasocial.com), el marketplace que conecta marcas con creadores y estudios en Latinoamérica.

🎥 **Video demo:** _pega aquí el link de YouTube_

![El Asistente Inda trabajando: lee el brief, revisa perfiles y descarta los que no encajan](docs/asistente-inda-match.png)

---

## El problema

Una marca que quiere producir una campaña tiene que hacer dos trabajos que nadie le resuelve juntos:

1. **Encontrar a quién contratar:** revisar portafolios, servicios, precios y ciudad de decenas de creadores y estudios.
2. **Conseguir todo lo físico que necesita la producción:** fondos, telas, props… comprando en varias tiendas, cuidando el presupuesto y sin repetir lo que el estudio ya tiene.

## La solución: un solo agente, de principio a fin

El **Asistente Inda** vive dentro de Indasocial y acompaña a la marca con dos habilidades:

| | Habilidad | Dónde | Qué hace |
|---|---|---|---|
| 1 | **Encontrar el match** | Dashboard | Entiende el brief, pregunta solo lo que falta, revisa todos los perfiles y muestra los 3 mejores con su porcentaje y **por qué** encajan. |
| 2 | **Comprar el kit de producción** | MatchChat (`@inda`) | Busca en los catálogos de **Reap**, omite lo que el estudio ya tiene, cotiza con envío al estudio dentro del presupuesto y deja cada pedido listo para que la marca lo apruebe. |

Mientras trabaja, **muestra cada paso en vivo** ("Revisé 6 perfiles…", "Reap · busqué *photography backdrop*…", "Reap · coticé con…"), así la marca ve qué hace y por qué.

![El Asistente Inda comprando con Reap: busca, cotiza con envío y respeta el presupuesto](docs/asistente-inda-reap.png)

## La historia del demo

**EcoFashion Co.** quiere lanzar su colección eco con 3 reels.

1. **Brief:** la marca le escribe al Asistente Inda: *"Busco un estudio de producción de video con luz y sonido en CDMX para 3 reels de nuestra colección eco, presupuesto $2,500 USD"*.
2. **Mejor match:** **Estudio Lumen** sale con 100%: cubre video, luz y sonido, está en CDMX y entra en el presupuesto.
3. **Propuesta en MatchChat:** el estudio la acepta. Hasta ese momento, correos y teléfonos están ocultos.
4. **Pago del servicio:** $2,500 USD. El estudio recibe $2,000 e Indasocial cobra 20% de comisión (Stripe Connect, simulado en este prototipo).
5. **Kit de producción con Reap:** la marca escribe `@inda arma el kit de producción`. El agente omite luz, audio y tripié (el estudio ya los tiene), compra escenografía y fondo con envío al estudio, y **la marca aprueba cada cobro en la página de Reap**.

## Cómo usa Reap Agentic Payments

| Paso | Endpoint de Reap | Para qué |
|---|---|---|
| Guardar tarjeta | `POST /agentic/enrollments` · `GET /agentic/enrollments/:id` | La marca guarda su tarjeta **una vez** en la página de Reap. Indasocial nunca ve el número. |
| Buscar insumos | `POST /agentic/products/search` · `POST /agentic/products/details` | El agente busca en el catálogo y elige variantes disponibles, en USD y dentro del presupuesto. |
| Cotizar | `POST /agentic/quotes` · `POST /agentic/quotes/:id/shipping-option` | Cotiza por comercio con envío al estudio y elige el envío más barato. |
| Cobrar con aprobación | `POST /agentic/checkouts` · `GET /agentic/checkouts/:id` | Abre el checkout; la marca lo aprueba en Reap. Se guarda el `orderId` y se concilia contra `finalAmount`. |

API: `https://sg.sandbox.api.reap.global` · header `Reap-Version: 2025-02-14` · [documentación](https://docs.reap.global/agentic-payments/overview)

## Seguridad: lo que el agente no puede hacer

- **No cobra sin aprobación:** cada pedido se aprueba en la página de Reap.
- **No ve tarjetas:** los datos de la tarjeta solo se escriben en Reap.
- **No se pasa del presupuesto:** la suma de pedidos (con envío e impuestos) nunca supera el presupuesto de producción.
- **No compra antes de tiempo:** solo con una propuesta aceptada **y** pagada, y solo la marca dueña de la propuesta.
- **No compra lo que el estudio ya tiene.**
- **No se deja manipular:** el ranking usa solo datos estructurados del perfil; el texto libre de las bios no cuenta (hay una prueba con un perfil que intenta darle instrucciones).
- **No expone contactos:** correos, teléfonos y @usuarios se ocultan hasta que el estudio acepta.
- Si una cotización expira, vuelve a cotizar antes de cobrar.

---

## Pruébalo

### Opción 1: sin instalar nada (simulado)

Doble clic en `public/index.html`. Todo corre en tu navegador con un simulador de Reap.

### Opción 2: en local (VS Code)

```bash
npm install
npm start
```

Abre **http://localhost:3000**.

- El **recuadro morado** te dice qué hacer en cada paso; **"Hazlo por mí"** lo hace por ti.
- **"▶ Reproducir demo completo"** corre toda la historia sola.
- **http://localhost:3000/?video** corre la versión con subtítulos (la del video).

### Opción 3: con el sandbox real de Reap

1. Crea un archivo **`reap.env`** en la carpeta del proyecto (está en `.gitignore`, **nunca** se sube):
   ```
   REAP_MODE=sandbox
   REAP_API_KEY=tu_key_del_sandbox
   REAP_BASE_URL=https://sg.sandbox.api.reap.global
   REAP_VERSION=2025-02-14
   ```
2. Revisa la conexión (no cobra nada):
   ```bash
   npm run reap:check
   ```
   Si dice que los comercios no envían a México, agrega `REAP_SANDBOX_SHIP_TO=US` a `reap.env`: en sandbox se cotiza con una dirección de prueba en EE. UU. y el agente lo dice en sus pasos.
3. `npm start`. La terminal debe decir **"Reap: sandbox real"**.
4. Al guardar la tarjeta y al aprobar cada pedido se abre la página de Reap en otra pestaña (OTP del sandbox: `456789`). La app espera el resultado sola.

### Desplegar en Vercel

Importa el repo en Vercel sin cambiar nada (`vercel.json` ya está listo). Esa versión corre en **modo simulado**, porque la key de Reap nunca puede ir al navegador; el sandbox real corre con `npm start`.

## Qué es real y qué está simulado

| Pieza | Estado |
|---|---|
| Reap Agentic Payments | **Real** con `reap.env` (sandbox) · simulado sin key |
| Asistente Inda | Real: reglas deterministas, sin LLM (listo para sumar un LLM manteniendo las mismas reglas) |
| Stripe Connect (pago del servicio, 20%) | Simulado |
| Datos de marcas y estudios | Ficticios, en memoria (en producción: Supabase, ver `sql/001_campaign_kit.sql`) |

## Para desarrollo

```bash
npm test             # 34 pruebas, incluida una prueba de contrato contra la API documentada de Reap
npm run reap:check   # prueba la conexión con el sandbox real (no cobra)
npm run build        # recompila public/engine.js si cambias algo en src/
```

```
src/agent/inda.js                  el agente: Asistente Inda (une sus dos habilidades)
src/agent/skills/matchmaker.js     habilidad 1: brief → preguntas → ranking con razones
src/agent/skills/productionKit.js  habilidad 2: kit de producción con Reap desde MatchChat (@inda)
src/agent/skills/needs.js          propuesta + mensaje → insumos, sin repetir el equipo del estudio
src/deals.js                       match → propuesta → aceptación → pago del servicio (20%)
src/reap/client.js                 cliente de Reap (sandbox real) + selector de modo
src/reap/mock.js                   simulador local de Reap
src/backend.js                     API sin servidor (la usan Express y el navegador)
src/app.js · src/server.js         servidor Express
public/index.html                  interfaz: Asistente Inda + MatchChat
public/engine.js                   backend compilado para el navegador (npm run build)
scripts/reap-check.mjs             prueba de conexión con el sandbox real
test/                              pruebas (test/fakeReap.js valida cada petición contra la API documentada)
docs/                              guion, subtítulos y capturas del video demo
sql/001_campaign_kit.sql           tablas y RLS para Supabase
```

<details>
<summary>Endpoints de la app</summary>

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/assistant/messages` | Mensaje de la marca al Asistente Inda |
| POST | `/api/assistant/matches/:creatorId/select` | Elegir match y enviar propuesta |
| POST | `/api/proposals/:id/accept` · `/decline` | El estudio responde |
| POST | `/api/proposals/:id/pay-fee` | La marca paga el servicio (simulado) |
| POST | `/api/proposals/:id/chat` | MatchChat (`@inda` arma el kit) |
| POST · GET | `/api/brands/:brandId/card` | Guardar tarjeta en Reap · ver su estado |
| POST | `/api/kit-orders/:id/approve` | Checkout y URL de aprobación en Reap |
| GET | `/api/kit-orders/:id` | Sincronizar estado con Reap |
| GET · POST | `/api/demo` · `/api/demo/reset` | Estado y reinicio del demo |

En el prototipo el usuario se identifica con el header `x-user-id`; en Indasocial sale del JWT de Supabase Auth.
</details>

## Siguiente paso

- Conectar Supabase y Stripe Connect reales, y mover el servidor a funciones de Vercel.
- El sentido inverso: un creador le pide al Asistente Inda marcas con campañas abiertas y el agente le ayuda con su propuesta.

---

<details>
<summary><b>In English</b></summary>

**Agente Indasocial × Reap** is a single AI agent, *Asistente Inda*, built into Indasocial (a LatAm creator–brand marketplace). It (1) turns a brand's brief into the best-matching production studio, explaining why each match fits, and (2) inside the deal chat, when the brand types `@inda`, buys the physical production supplies through **Reap Agentic Payments**: it searches Reap's merchant catalogs, skips gear the studio already owns, quotes with shipping to the studio within the production budget, and opens checkouts that the brand approves on Reap's hosted page. The agent never sees card data and never charges without approval. Every step it takes is shown live in the UI.

Run it with `npm install && npm start` (simulated), or add a `reap.env` with a Reap sandbox key and run `npm run reap:check` then `npm start` for the real sandbox.
</details>

Hecho por **Miriam León** · Indasocial
