# Cambios

Las notas completas de cada versión están en [Releases](https://github.com/jorgehsy/grafito/releases).

## v0.2.0-alpha.4 · 2026-10-27

- Iconos de AWS: actívalos en Opciones → Iconos, y Claude pone el icono oficial (Lambda, S3, Cognito… 40 servicios) junto a las cajas que son servicios de AWS.
- Los iconos son de AWS y no están bajo la licencia MIT (ver `packages/icons/src/aws/NOTICE.md`).
- Panel de opciones en tarjetas: Modelo, Idioma y Vista.

## v0.2.0-alpha.3 · 2026-10-26

- Las etiquetas de flecha largas (más de 22 caracteres) se parten en dos líneas, y el espacio reservado coincide con lo dibujado.

## v0.2.0-alpha.2 · 2026-10-23

- Caja para escribir a Claude si no tienes micrófono: Enter o Enviar manda el texto.
- Las etiquetas de las flechas ya no quedan encima de los bloques.
- Los diagramas muy anchos se dibujan de arriba hacia abajo para aprovechar la pantalla.
- La `ANTHROPIC_API_KEY` del `.env` manda sobre la del shell.
- Se trabaja en `main` (se retira la rama `alpha-grafitodesign`).

## v0.2.0-alpha.1 · 2026-10-23

Primera alfa pública.

- Nuevo diseño estilo papel como versión oficial.
- Voz en vivo en español: hablas y Claude dibuja el tablero.
- Órdenes con "Grafito, …" y Deshacer instrucción.
- Formas de dibujo: Auto, Mapa, Flujo, Escala, Ciclo, Línea de tiempo, Árbol, Sistema, Lista y Comparar.
- Sesiones guardadas, Restaurar, Importar y Exportar (JSON y SVG).
- Candado de micrófono entre pestañas.
