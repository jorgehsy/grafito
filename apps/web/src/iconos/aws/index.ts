// Cargador para el navegador: los SVG como texto, por id de servicio. Lo comparten el selector y el dibujo.
// Aparte de servicios.ts, que es dato puro (lo leen también Node y el servidor).
const crudos = import.meta.glob("@aws-svg/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** id de servicio (`lambda`) -> texto del SVG. */
export const ICONOS_AWS: Record<string, string> = Object.fromEntries(
  Object.entries(crudos).map(([ruta, svg]) => [ruta.replace(/^.*\//, "").replace(/\.svg$/, ""), svg]),
);
