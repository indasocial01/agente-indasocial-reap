# Guion del video demo (≈1:40)

El video muestra **un solo agente de IA, el Asistente Inda**, de principio a fin: encuentra el estudio ideal y luego compra los insumos con Reap.

El video `indasocial-reap-demo.mp4` ya trae estos textos en pantalla. Si quieres ponerle tu voz, lee cada bloque cuando aparezca (el tiempo es aproximado).

| Tiempo | Escena | Qué decir |
|---|---|---|
| 0:00 | Indasocial × Reap | Un solo agente de IA, el Asistente Inda, encuentra el estudio ideal para la marca y después compra los insumos de la campaña con Reap. La marca aprueba cada pago. |
| 0:06 | 1 · El brief | La marca EcoFashion le pide al Asistente Inda, su agente de IA, un estudio de video con luz y sonido en CDMX. El asistente arma el brief, revisa todos los perfiles y descarta los que no encajan. No lee las bios, así ningún perfil puede manipularlo. |
| 0:20 | 2 · El mejor match | Estudio Lumen sale con 100%: cubre video, luz y sonido, está en CDMX y entra en el presupuesto. La marca lo elige y la propuesta viaja por MatchChat. |
| 0:27 | 3 · La propuesta | Ahora vemos la pantalla de Estudio Lumen. Acepta la propuesta. Hasta este momento los correos y teléfonos estaban ocultos. |
| 0:35 | 4 · Pago del servicio | La marca paga $2,500 USD. Estudio Lumen recibe $2,000 e Indasocial cobra 20% de comisión (Stripe Connect, simulado). Con el pago, el Asistente Inda ya puede comprar los insumos. |
| 0:43 | 5 · Tarjeta en Reap | La marca guarda su tarjeta una sola vez, en una página de Reap. Indasocial y el Asistente Inda nunca ven el número. |
| 0:53 | 5 · El mismo agente compra con Reap | La marca escribe @inda en MatchChat. El Asistente Inda busca insumos en el catálogo de Reap, omite lo que el estudio ya tiene (luz, audio, tripié) y cotiza con envío al estudio sin pasar de $150 USD. |
| 1:09 | 5 · Aprobación en Reap | El Asistente Inda no puede cobrar solo. La marca revisa artículos, envío e impuestos, y aprueba el pago en la ventana de Reap. |
| 1:19 | 5 · Segundo pedido | Misma regla para el otro comercio: ningún cobro sin la aprobación de la marca en Reap. |
| 1:24 | Listo | Del brief al kit pagado: el estudio recibe los insumos y la marca nunca perdió el control del dinero. |
| 1:29 | Del match al kit, con IA | Un solo agente acompaña a la marca de principio a fin: encuentra al mejor estudio y compra los insumos en Reap, dentro del presupuesto y solo con su aprobación. |

## Grabar tu propia versión

1. `npm start` y abre **http://localhost:3000/?video** (o abre `public/index.html?video`).
2. La página corre sola con portada, subtítulos y cierre. Graba la pantalla (en Mac: **Cmd + Shift + 5** → Grabar pantalla completa).
3. Pon el navegador en pantalla completa antes de empezar para que no se vean pestañas.

`docs/demo-video.srt` son los mismos subtítulos por si los quieres subir aparte (YouTube, Loom, etc.).

> Todo lo que se ve es simulado (Reap y Stripe). El código ya está listo para el sandbox real de Reap en cuanto se agregue la API key.
