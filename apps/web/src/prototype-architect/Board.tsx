import type { ReactNode } from "react";
import rough from "roughjs";
import { EDGES, ELEMENTS, STAGE, type Edge, type El, type Status } from "./core";

const gen = rough.generator();
type Paths = ReturnType<typeof gen.toPaths>;
interface Shapes {
  pencil: Paths[];
  ink: Paths;
}

function seedOf(id: string) {
  let h = 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) + 1;
}

const PENCIL = { stroke: "#8A8A90", strokeWidth: 1, roughness: 2.3, bowing: 1.6 };
const cache = new Map<string, Shapes>();

function elShapes(el: El): Shapes {
  let c = cache.get(el.id);
  if (!c) {
    const seed = seedOf(el.id);
    const dash = el.kind === "group" ? [7, 6] : undefined;
    const rect = (o: object) => gen.rectangle(el.x, el.y, el.w, el.h, { strokeLineDash: dash, ...o });
    c = {
      pencil: [0, 1].map((i) => gen.toPaths(rect({ ...PENCIL, seed: seed + i * 17 }))),
      ink: gen.toPaths(
        rect({
          seed,
          roughness: 1.1,
          strokeWidth: el.kind === "group" ? 1.4 : 1.9,
          stroke: el.kind === "group" ? "#3E5E8C" : "#2A2A2E",
          fill: el.kind === "group" ? undefined : "#EEF2F8",
          fillStyle: "solid",
        }),
      ),
    };
    cache.set(el.id, c);
  }
  return c;
}

function edgeShapes(e: Edge): Shapes {
  let c = cache.get(e.id);
  if (!c) {
    const seed = seedOf(e.id);
    const [ax, ay] = e.a;
    const [bx, by] = e.b;
    const ang = Math.atan2(by - ay, bx - ax);
    const mk = (o: object): Paths => {
      const lines = [gen.line(ax, ay, bx, by, o)];
      for (const d of [-0.5, 0.5]) lines.push(gen.line(bx, by, bx - 10 * Math.cos(ang + d), by - 10 * Math.sin(ang + d), o));
      return lines.flatMap((l) => gen.toPaths(l));
    };
    c = { pencil: [mk({ ...PENCIL, seed })], ink: mk({ seed, roughness: 1, strokeWidth: 1.8, stroke: "#2A2A2E" }) };
    cache.set(e.id, c);
  }
  return c;
}

function P({ paths }: { paths: Paths }) {
  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.strokeWidth} pathLength={p.stroke === "none" ? undefined : 1} />
      ))}
    </>
  );
}

function Shape({ id, status, shapes, children }: { id: string; status: Status; shapes: Shapes; children?: ReactNode }) {
  if (status === "none") return null;
  return (
    <g className={`pa-el st-${status}`} data-id={id}>
      <g className="pen">
        {shapes.pencil.map((p, i) => (
          <P key={i} paths={p} />
        ))}
      </g>
      <g className="ink">
        <P paths={shapes.ink} />
      </g>
      {children}
    </g>
  );
}

export function Board({ status }: { status: Record<string, Status> }) {
  return (
    <svg className="pa-svg" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} width={STAGE.w} height={STAGE.h}>
      {ELEMENTS.map((el) => (
        <Shape key={el.id} id={el.id} status={status[el.grp] ?? "none"} shapes={elShapes(el)}>
          {el.kind === "group" ? (
            <text x={el.x + 14} y={el.y + 26} className="pa-gl">
              {el.label}
            </text>
          ) : (
            <text x={el.x + el.w / 2} y={el.y + el.h / 2 + (el.sub ? -2 : 6)} textAnchor="middle" className="pa-tx">
              {el.label}
              {el.sub && (
                <tspan x={el.x + el.w / 2} dy={19} className="pa-sub">
                  {el.sub}
                </tspan>
              )}
            </text>
          )}
        </Shape>
      ))}
      {EDGES.map((e) => (
        <Shape key={e.id} id={e.id} status={status[e.grp] ?? "none"} shapes={edgeShapes(e)} />
      ))}
    </svg>
  );
}
