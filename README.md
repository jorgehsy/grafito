<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="grafito" width="420">
  </picture>
</p>

<p align="center">
  <strong>Tú hablas. Claude dibuja la pizarra en vivo, trazo a trazo.</strong><br>
  <sub>Estado: <b>alfa</b> · Voz en español · Hecho con Claude, React y rough.js</sub>
</p>

<p align="center">
  <a href="https://github.com/jorgehsy/grafito/releases"><img src="https://img.shields.io/github/v/release/jorgehsy/grafito?include_prereleases&label=versi%C3%B3n" alt="Versión"></a>
  <a href="https://github.com/jorgehsy/grafito/actions/workflows/ci.yml"><img src="https://github.com/jorgehsy/grafito/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jorgehsy/grafito" alt="Licencia MIT"></a>
</p>

---

**grafito** convierte lo que dices en voz alta en un tablero dibujado a mano. Explicas una arquitectura, un proceso o una idea, y mientras hablas aparecen zonas, cajas, flechas, líneas de tiempo, árboles y notas, como si alguien lo dibujara en una pizarra a tu lado.

> ⚠️ **Fase alfa.** Funciona, pero cambia seguido y puede romperse. Úsalo para probar y danos tu opinión.

## Qué hace

- 🎙️ **Voz en vivo.** Hablas en español y el tablero se va dibujando mientras hablas.
- ✍️ **Estilo a mano.** Trazos animados con rough.js, resaltador y cámara que sigue lo nuevo.
- 🧭 **Formas de dibujo.** Auto, Mapa, Flujo, Escala, Ciclo, Línea de tiempo, Árbol, Sistema, Lista o Comparar.
- 🪄 **Órdenes por voz.** Di *"Grafito, …"* para pedir cambios: *"Grafito, separa esto en dos diagramas"*.
- 💾 **Guarda solo.** Cada sesión se guarda en `pruebas/`. Puedes restaurar, importar y exportar (JSON y SVG).
- 💲 **Costo visible.** Muestra tokens y costo en dólares de cada petición.
- ☁️ **Iconos de AWS.** Prende el catálogo en Opciones → Iconos y Claude pone el icono oficial (Lambda, S3, Cognito… 40 servicios) junto a las cajas que son servicios de AWS.
- ▶️ **Modo guion.** Demos sin Claude y sin gastar nada, para ver cómo funciona.

## Qué necesitas

| Cosa | Detalle |
| --- | --- |
| Node.js | 20.19 o más nuevo (recomendado 22+) |
| Navegador | **Chrome** (o Safari). Firefox no tiene reconocimiento de voz. |
| Clave de Anthropic | Una API key de [console.anthropic.com](https://console.anthropic.com/). El uso se cobra en tu cuenta. |
| Micrófono | Para el modo voz. Sin micrófono puedes escribir o pegar texto. |

## Instalar

Puedes bajar la última versión desde [Releases](https://github.com/jorgehsy/grafito/releases) (archivo `grafito-vX.Y.Z-source.tar.gz`) o clonar el repositorio:

```bash
git clone https://github.com/jorgehsy/grafito.git
cd grafito
npm install
cp .env.example .env
```

Abre `.env` y pega tu clave:

```
ANTHROPIC_API_KEY=sk-ant-...
```

La clave solo la lee el servidor local. Nunca llega al navegador.

## Usar

1. Arranca todo con un comando:

   ```bash
   npm run dev
   ```

   Esto levanta dos cosas: el servidor (puerto `8787`) y la web (puerto `5173`).

2. Abre **http://localhost:5173/?mode=claude** en Chrome.
3. Pulsa **Hablar** (o la barra espaciadora) y permite el micrófono.
4. Habla. El tablero se dibuja solo.

### Otras formas de usarlo

- **Sin micrófono:** escribe o pega texto en el panel y pulsa **Enviar todo**, o **Simular dictado** para soltarlo frase a frase.
- **Darle órdenes:** di o escribe *"Grafito"* y luego la orden. Lo anterior se dibuja; lo posterior se toma como instrucción. Si no te gusta el resultado, usa **Deshacer instrucción**.
- **Elegir la forma:** en **Opciones** eliges la forma del dibujo, el modelo (Sonnet por defecto, Haiku más barato) y el idioma (es-CL, es-AR, es-MX, es-ES, en-US).
- **Ver costos:** pulsa **F3** o el botón de estadísticas.
- **Demo sin gastar:** abre **http://localhost:5173/** y elige un guion. Atajo: `/?auto=arquitectura&speed=2`.
- **Moverte:** rueda del mouse = zoom, arrastrar = mover.

### Sesiones guardadas

- Cada sesión se guarda en `pruebas/` (en tu disco, no se sube a git).
- Nota (monorepo): ahora se guardan en `apps/server/sessions/` y la clave va en `apps/server/.env`.
- Al recargar, puedes **Restaurar** la última sesión.
- **Exportar** baja un `.json` y el tablero como `.svg`. **Importar** carga un `.json`.
- **Limpiar** empieza una sesión nueva.

## Privacidad

- Tu texto se envía a la API de Anthropic para dibujar.
- La voz la transcribe el navegador. En Chrome, el audio pasa por el servicio de voz de Google.
- Las sesiones quedan en tu disco, en `pruebas/`.

## Problemas comunes

| Pasa esto | Haz esto |
| --- | --- |
| "Falta la API key en .env" | Revisa que `.env` tenga tu clave real y reinicia `npm run dev`. |
| El micrófono no arranca | Usa Chrome, entra por `localhost` y revisa el permiso del micrófono. |
| "El micrófono se activó en otra pestaña" | Solo una pestaña puede escuchar a la vez. Pulsa Hablar en la pestaña que quieras usar. |
| No reconoce bien lo que digo | Cambia el idioma en Opciones al de tu país. |

## Para desarrolladores

```bash
npm test           # pruebas (vitest)
npm run typecheck  # revisa tipos
npm run build      # compila para producción
npm run iconos:aws <zip>  # reinstala los iconos de AWS desde el paquete oficial
```

**Cómo funciona, en corto:** la voz se vuelve texto en el navegador. El texto va a `POST /api/board` (`server/board.ts`). Claude responde con *operaciones* (crear zona, agregar caja, conectar, etc.) usando herramientas en streaming. El navegador aplica cada operación al tablero y la anima.

| Carpeta | Qué hay |
| --- | --- |
| `server/` | Servidor Express. Habla con Claude y guarda sesiones. |
| `src/board/ops.ts` | El vocabulario de operaciones. Una sola fuente de verdad para cliente y servidor. |
| `src/board/model.ts`, `layout.ts` | Estado del tablero y cómo se acomoda en pantalla. |
| `src/board/animator.ts`, `render/` | Animación de trazos, cámara y estilo a mano. |
| `src/board/live/` | Panel en vivo, streaming, voz (`speech/`) y precios. |
| `src/board/scripts/` | Guiones de demo. |

La primera versión (con Excalidraw) sigue en `/v1.html` como referencia. Ya no se mantiene.

### Versiones y releases

Las versiones siguen [SemVer](https://semver.org/lang/es/). Mientras sea alfa llevan el sufijo `-alpha.N` y salen marcadas como *pre-release*. Los cambios de cada versión están en [CHANGELOG.md](CHANGELOG.md).

- **CI** (`.github/workflows/ci.yml`): en cada push a `main` y en cada PR corre tipos, pruebas y build.
- **Release** (`.github/workflows/release.yml`): al subir una etiqueta `v*` vuelve a probar, compila y crea el release en GitHub con notas automáticas y dos archivos (código fuente y `dist/` compilado).

Para publicar una versión nueva:

```bash
npm version prerelease --preid alpha   # 0.2.0-alpha.1 → 0.2.0-alpha.2 (crea commit y etiqueta)
git push --follow-tags
```

Usa `npm version minor` o `npm version patch` cuando salga de alfa.

## Hoja de ruta

- [ ] Reconocimiento de voz en la nube (para Firefox y mejor precisión)
- [ ] Más formas de dibujo
- [ ] Versión publicada en la web, sin instalar nada

## Contribuir

¡Bienvenido! Abre un *issue* con lo que encontraste o lo que te gustaría. Si mandas un *pull request*, corre `npm test` y `npm run typecheck` antes.

## Licencia

[MIT](LICENSE) © 2026 Jorge Simoes, excepto los iconos de `packages/icons/src/aws/` (ver [NOTICE.md](packages/icons/src/aws/NOTICE.md)).

Amazon Web Services, AWS y los iconos de sus servicios son marcas de Amazon.com, Inc. o sus filiales. Grafito no está afiliado a AWS ni cuenta con su respaldo.

<sub>Amazon Web Services, AWS and the related service icons are trademarks of Amazon.com, Inc. or its affiliates. Grafito is not affiliated with or endorsed by AWS.</sub>
