// What every browser check shares: opening the app so that it can never spend money, and a few hands.
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The routes that call Claude from the page. A check that reaches one fails. */
const PAID = ["**/api/board", "**/api/architect"];

/**
 * Opens the app at `url` with every paid path closed: the sketch auto-read is off (it would hand the ink to
 * Claude 2.2 s after a stroke, in a room too), and a request to a Claude route is cut and recorded.
 * Returns the list of cut requests; `expectFree` asserts it is empty.
 */
export async function open(page: Page, url: string): Promise<string[]> {
  const paid: string[] = [];
  await page.addInitScript(() => localStorage.setItem("grafito.draw.auto", "0"));
  for (const glob of PAID) await page.route(glob, (route) => { paid.push(route.request().url()); return route.abort(); });
  await page.goto(url);
  await expect(page.getByTestId("modes")).toBeVisible();
  return paid;
}

export const expectFree = (paid: string[]) => expect(paid, "a check must not call Claude").toEqual([]);

export const modeTab = (page: Page, mode: "live" | "demo" | "architect") => page.getByTestId(`mode-${mode}`);

/** The three mode tabs can be pressed. */
export async function expectModesOpen(page: Page) {
  for (const m of ["live", "demo", "architect"] as const) await expect(modeTab(page, m)).toBeEnabled();
}

/** Hand-drawn strokes on the board. */
export const ink = (page: Page): Locator => page.locator(".canvas2 svg path[data-stroke]");

/** The hook the app leaves on `window` for checks like these (BoardApp.tsx). */
type Hook = { __grafito: { controller: { board: { zones: { kind: string }[] } } } };

/** What Claude (or a demo) drew: the board's zones. */
export const zones = (page: Page) => page.evaluate(() => (window as unknown as Hook).__grafito.controller.board.zones.length);

/** The kind of each zone on the board. An empty architect board is `["system"]`: that mode makes its own zone. */
export const zoneKinds = (page: Page) => page.evaluate(() => (window as unknown as Hook).__grafito.controller.board.zones.map((z) => z.kind));

/** Waits until a script has drawn something (a demo first "dictates" for a few seconds). */
export const expectDrawing = (page: Page) => expect.poll(() => zones(page), { timeout: 20_000 }).toBeGreaterThan(0);

/** Presses at `from`, moves to `to` in steps, releases. `each` runs after every step, while the button is down. */
export async function drag(page: Page, from: [number, number], to: [number, number], each?: () => Promise<void>) {
  const steps = 8;
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await each?.();
  }
  await page.mouse.up();
}

/** Draws one pen stroke across the middle of the board. */
export async function drawStroke(page: Page, from: [number, number] = [560, 380], to: [number, number] = [860, 520]) {
  await page.getByTestId("tool-pen").click();
  await drag(page, from, to);
}
