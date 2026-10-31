// Cola de animación: diff entre árboles de render -> tareas.
// draw / update / delete se ejecutan en secuencia; los movimientos van en paralelo.
import type { RenderTree } from "./tree";
import { geomEqual } from "./tree";

export type SeqTask =
  | { kind: "draw"; key: string }
  | { kind: "update"; key: string }
  | { kind: "delete"; keys: string[] };
export interface MoveTask { kind: "move"; key: string }
export interface Diff { sequential: SeqTask[]; moves: MoveTask[] }

const KIND_ORDER = ["zone", "element", "edge", "emphasis", "question", "callout"];

export function diffTrees(prev: RenderTree, next: RenderTree): Diff {
  const sequential: SeqTask[] = [];
  const moves: MoveTask[] = [];
  const gone = prev.items.filter((i) => !next.map.has(i.key)).map((i) => i.key);
  if (gone.length) sequential.push({ kind: "delete", keys: gone });
  for (const n of next.items) {
    const p = prev.map.get(n.key);
    if (p && p.sig !== n.sig) sequential.push({ kind: "update", key: n.key });
  }
  const added = next.items
    .filter((n) => !prev.map.has(n.key))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const n of added) sequential.push({ kind: "draw", key: n.key });
  for (const n of next.items) {
    const p = prev.map.get(n.key);
    if (p && (!geomEqual(p.geom, n.geom) || p.hue !== n.hue)) moves.push({ kind: "move", key: n.key });
  }
  return { sequential, moves };
}

export const INSTANT = Infinity;
/** 1x con <=2 tareas pendientes, sube hasta 4x a las 12, por encima termina al instante. */
export function speedForBacklog(pending: number): number {
  if (pending <= 2) return 1;
  if (pending > 12) return INSTANT;
  return 1 + (3 * (pending - 2)) / 10;
}

export interface Executor {
  draw(key: string, speed: number): Promise<void>;
  update(key: string, speed: number): Promise<void>;
  remove(keys: string[], speed: number): Promise<void>;
  move(key: string): void;
}

export class AnimationQueue {
  private q: SeqTask[] = [];
  private running = false;
  private epoch = 0;
  /** velocidades usadas por cada tarea ejecutada (útil para pruebas y depuración) */
  readonly log: { task: SeqTask; speed: number }[] = [];
  onChange?: (pending: number, speed: number) => void;
  private idle: (() => void)[] = [];

  constructor(private exec: Executor) {}

  get pending(): number {
    return this.q.length + (this.running ? 1 : 0);
  }
  get speed(): number {
    return speedForBacklog(this.pending);
  }

  push(diff: Diff) {
    for (const m of diff.moves) this.exec.move(m.key);
    this.q.push(...diff.sequential);
    this.onChange?.(this.pending, this.speed);
    void this.run();
  }

  reset() {
    this.epoch++;
    this.q = [];
    this.running = false;
    this.onChange?.(0, 1);
    this.idle.splice(0).forEach((f) => f());
  }

  whenIdle(): Promise<void> {
    return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.idle.push(r));
  }

  private async run() {
    if (this.running) return;
    const epoch = this.epoch;
    this.running = true;
    while (this.q.length && epoch === this.epoch) {
      const task = this.q.shift()!;
      const speed = speedForBacklog(this.q.length + 1);
      this.log.push({ task, speed });
      this.onChange?.(this.pending, speed);
      try {
        if (task.kind === "draw") await this.exec.draw(task.key, speed);
        else if (task.kind === "update") await this.exec.update(task.key, speed);
        else await this.exec.remove(task.keys, speed);
      } catch {
        /* cancelada o fallida: seguimos con la siguiente */
      }
    }
    if (epoch !== this.epoch) return;
    this.running = false;
    this.onChange?.(this.pending, 1);
    this.idle.splice(0).forEach((f) => f());
  }
}
