// Pega modelo + layout + diff + cola. Los ops se aplican al modelo de inmediato (en serie);
// la animación va por detrás con la cola.
import { applyOp, emptyBoard } from "./model";
import type { Board } from "./model";
import type { Op } from "./ops";
import { computeLayout } from "./layout";
import type { BoardLayout, Rect } from "./layout";
import { buildTree, emptyTree } from "./tree";
import type { RenderTree } from "./tree";
import { AnimationQueue, diffTrees } from "./animator";
import type { Executor } from "./animator";

export interface Sink extends Executor {
  setTarget(tree: RenderTree, bounds: Rect): void;
}

export class BoardController {
  board: Board = emptyBoard();
  tree: RenderTree = emptyTree();
  layout?: BoardLayout;
  readonly queue: AnimationQueue;
  private chain: Promise<void> = Promise.resolve();
  private epoch = 0;
  onWarnings?: (w: string[]) => void;
  onBoard?: (b: Board) => void;

  constructor(private sink: Sink) {
    this.queue = new AnimationQueue(sink);
  }

  submit(ops: Op[]): Promise<void> {
    const epoch = this.epoch;
    this.chain = this.chain.then(async () => {
      for (const o of ops) {
        if (epoch !== this.epoch) return;
        const r = applyOp(this.board, o);
        if (r.warnings.length) this.onWarnings?.(r.warnings);
        if (r.board === this.board) continue;
        const lay = await computeLayout(r.board);
        if (epoch !== this.epoch) return;
        this.board = r.board;
        this.layout = lay;
        const next = buildTree(r.board, lay);
        const diff = diffTrees(this.tree, next);
        this.tree = next;
        this.sink.setTarget(next, lay.bounds);
        this.queue.push(diff);
        this.onBoard?.(this.board);
      }
    });
    return this.chain;
  }

  reset() {
    this.epoch++;
    this.chain = Promise.resolve();
    this.board = emptyBoard();
    this.tree = emptyTree();
    this.layout = undefined;
    this.queue.reset();
    this.onBoard?.(this.board);
  }
}
