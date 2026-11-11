// Glues model + layout + diff + queue. Ops are applied to the model immediately (in series);
// the animation trails behind through the queue.
import { applyOp, emptyBoard } from "./model";
import type { ApplyResult, Board } from "./model";
import type { Op } from "@grafito/contract";
import { computeLayout } from "./layout";
import type { BoardLayout, Rect } from "./layout";
import { buildTree, emptyTree } from "./tree";
import type { RenderTree } from "./tree";
import { AnimationQueue, INSTANT, diffTrees } from "./animator";
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

  /** `apply` is the mode's apply step: `applyOp`, or `applyArchitectOp` in architect mode. */
  submit(ops: Op[], apply: (board: Board, op: Op) => ApplyResult = applyOp): Promise<void> {
    const epoch = this.epoch;
    this.chain = this.chain.then(async () => {
      for (const o of ops) {
        if (epoch !== this.epoch) return;
        const r = apply(this.board, o);
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

  /**
   * Replaces the board with the one `ops` build from empty and shows it at once, with no animation: a demo
   * seek. All ops are applied first and laid out once, which gives the same board, layout and tree as
   * submitting them one by one. `clear` runs right before the new board is shown (or at once if `ops` build
   * nothing): the place to empty the sink, so the old picture stays up while the layout is computed.
   */
  jump(ops: Op[], apply: (board: Board, op: Op) => ApplyResult = applyOp, clear?: () => void): Promise<void> {
    this.reset();
    const epoch = this.epoch;
    let board = this.board;
    for (const o of ops) board = apply(board, o).board;
    if (board === this.board) { clear?.(); return this.chain; }
    this.chain = this.chain.then(async () => {
      const lay = await computeLayout(board);
      if (epoch !== this.epoch) return;
      clear?.();
      this.board = board;
      this.layout = lay;
      const next = buildTree(board, lay);
      const diff = diffTrees(this.tree, next);
      this.tree = next;
      this.sink.setTarget(next, lay.bounds);
      for (const t of diff.sequential) if (t.kind === "draw") void this.sink.draw(t.key, INSTANT);
      this.onBoard?.(this.board);
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
