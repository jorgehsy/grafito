// Browser loader: the SVGs as text, by service id. Shared by the settings picker and the stamp.
// Kept apart from services.ts, which is pure data (Node and the server read it too).
const rawSvgs = import.meta.glob("@aws-svg/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** service id (`lambda`) -> SVG text. */
export const AWS_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(rawSvgs).map(([path, svg]) => [path.replace(/^.*\//, "").replace(/\.svg$/, ""), svg]),
);
