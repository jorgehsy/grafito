# grafito · Prototipo 1

Convierte un monólogo hablado (en español) en un mapa mental dibujado a mano sobre un lienzo de Excalidraw, de forma incremental. Todavía sin voz: se pega texto y el modo "Simular dictado" lo va soltando frase a frase.

## Uso

1. Abre `.env` y pega tu clave: `ANTHROPIC_API_KEY=sk-ant-...` (la clave solo la lee el servidor, nunca llega al navegador).
2. `npm install`
3. `npm run dev`
4. Abre http://localhost:5173

Si falta la clave o sigue el marcador, la interfaz muestra "Falta la API key en .env".

## Qué hay

- `src/mindmap/model.ts`: modelo puro y `applyOp` (ignora operaciones inválidas y devuelve un aviso).
- `src/mindmap/layout.ts`: árbol radial con d3-hierarchy, sin solapes.
- `src/mindmap/render.ts`: mapa a elementos de Excalidraw con ids estables y fundido de entrada.
- `src/live/scheduler.ts`: una petición en vuelo; lo que llega mientras tanto se junta (`onFinalText`, reutilizable para voz).
- `server/draw.ts`: `POST /api/draw`, Claude con herramientas en streaming, eventos SSE `op`, `done` y `error`.

## Comandos

`npm test` (vitest) · `npm run typecheck` · `npm run build`

---

# grafito v2 (maqueta sin Claude)

Tablero hecho a mano (SVG + rough.js) que se dibuja trazo a trazo mientras se "dicta". Esta fase no llama a la API: dos guiones en español mueven el renderizador para juzgar animación y vocabulario. La v1 (Excalidraw) sigue en `/v1.html`.

## Uso

1. `npm install` y `npm run dev` (Vite avisa del puerto; normalmente http://localhost:5173).
2. `/` es la v2: elige guion (Arquitectura o Proceso), Play / Pausa / Reiniciar, velocidad 0.5x–2x, "Seguir cámara", cola de dibujo y subtítulos sincronizados.
3. Atajos por URL: `/?auto=arquitectura&speed=2` arranca solo.
4. Rueda = zoom, arrastrar = mover; la cámara deja de seguir 5 s tras tocarla.

## Estructura (`src/board/`)

- `ops.ts`: vocabulario de 16 operaciones (tipos TS + JSON Schema con forma de herramienta de Anthropic en `OP_TOOLS`), sin coordenadas. Reutilizable en el servidor.
- `model.ts`: `applyOp(board, op) -> {board, warnings}`; las operaciones inválidas se ignoran con aviso.
- `layout.ts`: zonas (pistas `place`, filas que envuelven, sin solapes) y contenido (elkjs para flow/system, d3-hierarchy para mindmap, filas para list/compare); conexiones entre zonas y notas con curvas bézier que esquivan cajas.
- `tree.ts` + `animator.ts`: árbol de render, diff -> tareas (draw/update/delete en secuencia, movimientos en paralelo) y velocidad según la cola (1x con <=2 pendientes, hasta 4x, instantáneo por encima de 12).
- `render/visuals.ts` y `render/engine.ts`: formas rough con semilla fija por id, trazo animado, lápiz, resaltador, tweens y cámara (`camera.ts`).
- `player.ts` y `scripts/`: reloj virtual, subtítulos y latencia simulada de 1,5–3 s; guiones `arquitectura.ts` y `proceso.ts`.

`npm test` · `npm run typecheck` · `npm run build` (genera `index.html` y `v1.html`).

---

# grafito v2 · modo "Claude en vivo"

El panel de la v2 tiene un selector **Guion (sin Claude)** / **Claude en vivo**. En el segundo, Claude dibuja el mismo tablero (mismo controlador, animador, resaltador y cámara que los guiones).

- **Servidor**: `POST /api/board` (`server/board.ts`) con `{ delta, summary, board, model }`. Las herramientas son `OP_TOOLS` de `src/board/ops.ts` (una sola fuente de verdad), con `eager_input_streaming` y `cache_control` en el prompt de sistema. Cada llamada se valida con ajv antes de emitirla. Eventos SSE: `op` (o `op` con `invalid`), `usage` (entrada/caché desde `message_start`; salida estimada con chars/4 hasta que llega la cifra real), `done` y `error`. `/api/draw` sigue sirviendo a la v1.
- **Tablero al modelo**: texto compacto (zonas, elementos, conexiones, notas, marcas) en `src/board/live/serialize.ts`; nunca el layout.
- **Cliente** (`src/board/live/`): `sse.ts` (parser y `streamBoard`), `session.ts` (scheduler: una petición en vuelo y lo que llega mientras tanto se junta), `dictation.ts`, `pricing.ts` (precios por modelo, único sitio) y `LivePanel.tsx`.
- **Panel**: texto, "Enviar todo", "Simular dictado" (frase a frase, 500–4000 ms), Detener, Limpiar, modelo (`claude-haiku-5-5` o `claude-sonnet-5-5`) y "Usar texto de un guion" para comparar con el dibujo del guion. Medidor siempre visible (petición actual y total de sesión, en $ con 4 decimales; "≈" = estimado) y registro por petición: texto, ms a la primera operación, ms totales, operaciones, tokens, coste y avisos de operaciones inválidas.
- La entrada de texto pasa por `onFinalText(text)`, donde se enchufará la voz.
- Modelo por defecto: `claude-sonnet-5-5` (Haiku sigue seleccionable).

### Modo voz (Prototipo 2)

Habla en español y Claude dibuja en vivo. Usa el reconocimiento de voz del navegador (`SpeechRecognition`), así que **requiere Chrome (o Safari)**; en Firefox el panel muestra un aviso y lo demás sigue funcionando.

1. Abre `http://localhost:<puerto>/?mode=claude` (localhost cuenta como contexto seguro; en otra dirección hace falta HTTPS).
2. Pulsa **🎙️ Hablar** (o la barra espaciadora cuando el foco no esté en un campo de texto) y **permite el micrófono** cuando el navegador lo pida.
3. Elige idioma en el selector (es-CL por defecto; es-AR, es-MX, es-ES, en-US).
4. Los parciales salen en gris cursiva; los finales pasan a subtítulos. Los finales se agrupan 800 ms (o al pasar de 250 chars) antes de enviarse; mientras hay una petición en curso, el scheduler junta lo nuevo.
5. Chrome corta el reconocimiento por silencio o red: se reinicia solo (con espera creciente y tope de 5 reintentos). Los errores (`not-allowed`, `network`, ...) se muestran en español.

Latencia: cada petición registra **voz→1.ª figura** (ms desde el último final del lote hasta la primera operación dibujada) y la mediana aparece en el medidor. Código en `src/board/live/speech/` (`SpeechSource` es la interfaz para cambiar a una STT en la nube).

- Atajo: `/?mode=claude`.
- **Zona `scale`** (barra con umbrales): `create_zone` kind `scale` (+ `min_label`/`max_label`), `add_mark` (`at` 0-100, `label`, `note`, `tone`) y `set_level` (relleno hasta `at`). Guion "Ventana de contexto".
- **Forma del dibujo**: selector Auto / Mapa / Flujo / Escala / Sistema / Lista / Comparar; viaja como `shape` en `POST /api/board` y el servidor lo añade al mensaje de usuario (no al prompt de sistema, que está en caché).

## Exportar y guardar pruebas

- **Autosave**: tras cada petición (termine bien o con error) y cada ~10 s mientras hay actividad, el panel envía el registro de la prueba a `POST /api/sessions`, que lo escribe en `pruebas/<AAAA-MM-DD_HH-mm-ss>_<id>.json` (en la raíz del repo; Vite ignora esa carpeta, así que escribir no recarga). Mismo id de sesión = mismo archivo. Además queda una copia en `localStorage`. Si el servidor falla, el panel muestra un aviso pequeño y el dibujo sigue.
- `GET /api/sessions` lista los archivos (archivo, inicio, peticiones, coste) y `GET /api/sessions/<archivo>` devuelve uno.
- **Registro** (`version: 1`): `id`, `startedAt`, `updatedAt`, `model`, `shape`, `lang`, `requests[]` (`n`, `model`, `text` completo, `startedAt`, `firstOpMs`, `voiceFirstMs`, `totalMs`, `ops[{name,input}]`, `invalid[]`, `usage{input,cacheRead,cacheWrite,output}`, `costUsd`, `error?`), `transcript[{text,at}]`, `summary`, `totals{requests,costUsd,medianVoiceFirstMs}`.
- **Restaurar**: al recargar en modo Claude, si hay una prueba sin cerrar aparece el aviso "Restaurar / Descartar". Restaurar repone todas las operaciones de golpe (la cola de dibujo pasa a modo rápido) y reconstruye registro, transcripción, totales y resumen. **Importar** carga un `.json` exportado o de `pruebas/` y lo restaura igual.
- **Exportar** descarga el `.json` y el tablero como `.svg` (estilos en línea). **Limpiar** empieza una sesión nueva; el archivo anterior se queda en `pruebas/`.

## Instrucciones a Claude

Di "Grafito" y después la orden: "Grafito, separa en dos diagramas la opción sin BFF y con BFF". Lo anterior a la palabra se dibuja como contenido; lo posterior se envía como instrucción (modo `instruction`) y no se dibuja como texto. Vale para voz, "Enviar todo" y "Simular dictado". Con la palabra en el búfer, la voz espera 2 s antes de enviar por si el reconocedor parte la orden.

En el registro, la fila lleva "🪄 Instrucción" y "✓ aplicada (N cambios)". **↩ Deshacer instrucción** (visible si hay una aplicada y nada en curso) marca la última como deshecha, limpia el tablero y repone las operaciones de las demás filas; el registro y la transcripción no se tocan. Lo deshecho se guarda (`undone`) y no se repone al restaurar.
