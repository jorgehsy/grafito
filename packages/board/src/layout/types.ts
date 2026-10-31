export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface ConnectionGeom {
  /** poly: orthogonal polyline (ELK). curve: 4 control points of a cubic bezier. */
  kind: "poly" | "curve";
  pts: Pt[];
  label?: { x: number; y: number; text: string };
  /** connection between zones (drawn lighter) */
  cross?: boolean;
}
export interface BoardLayout {
  zones: Record<string, Rect>;
  elements: Record<string, Rect>;
  connections: Record<string, ConnectionGeom>;
  callouts: Record<string, { box: Rect; lines: string[]; arrow: ConnectionGeom }>;
  /** compare: absolute x of each zone's divider line */
  dividers: Record<string, number>;
  /** scale: bar per zone (absolute rect with the end labels; x0 = start of the bar relative to rect.x) */
  scales: Record<string, ScaleGeom>;
  /** scale: side and stem of each mark */
  marks: Record<string, MarkGeom>;
  /** timeline: absolute x (start and end) of each span's bracket */
  spans: Record<string, SpanGeom>;
  /** loose texts with their own box: `when:<event>` (timeline) and `center:<zone>` (cycle) */
  labels: Record<string, Rect>;
  bounds: Rect;
}
export interface SpanGeom { x0: number; x1: number }
export interface ScaleGeom { bar: Rect; x0: number; w: number; h: number }
/** stem: [far edge of the bar, near edge (where the notch goes), attachment point on the box] */
export interface MarkGeom { side: "above" | "below"; stem: Pt[] }

/** A zone laid out in its own coordinates, before it is placed on the board. */
export interface ZoneLocal {
  w: number;
  h: number;
  elements: Record<string, Rect>;
  connections: Record<string, ConnectionGeom>;
  /** compare: x of the divider line */
  divider?: number;
  scale?: ScaleGeom;
  marks?: Record<string, MarkGeom>;
  spans?: Record<string, SpanGeom>;
  labels?: Record<string, Rect>;
  /** flow/system: direction ELK used */
  dir?: "RIGHT" | "DOWN";
}
