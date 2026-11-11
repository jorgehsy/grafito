// A room with two people: ink and cursors travel, moving the board does not move anyone's cursor, and Clear
// clears for everyone. Nobody types or hands a sketch in, so the room never calls Claude.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { drag, drawStroke, expectFree, expectModesOpen, ink, open } from "./app";

async function join(page: Page, name: string) {
  const dialog = page.getByTestId("room-join");
  await dialog.waitFor();
  await page.getByTestId("room-join-name").fill(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("avatar-me")).toBeVisible();
}

/** Where `name`'s cursor is on this page's board, in board coordinates; null while it is not shown. */
const cursorOf = (page: Page, name: string) =>
  page.evaluate((who) => {
    const g = [...document.querySelectorAll<SVGGElement>(".canvas2 svg g[data-sig]")].find((el) => el.dataset.sig!.startsWith(who + "|"));
    const m = g?.getAttribute("transform")?.match(/translate\(([-\d.e]+) ([-\d.e]+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }, name);

test("two people in a room", async ({ browser }) => {
  const ana = await (await browser.newContext()).newPage();
  const bea = await (await browser.newContext()).newPage();

  const paidAna = await open(ana, "/?mode=live");
  // The page leaves for the room as soon as it is made, so the answer is read on its way through.
  let room = { id: "", token: "" };
  await ana.route("**/api/rooms", async (route) => {
    const response = await route.fetch();
    room = await response.json();
    await route.fulfill({ response });
  });
  await ana.getByTestId("collaborate").click();
  await join(ana, "Ana");

  const paidBea = await open(bea, `/?room=${room.id}#k=${room.token}`);
  await join(bea, "Bea");

  await test.step("the mode tabs are open in a room", () => expectModesOpen(ana));

  await test.step("ink reaches the other person", async () => {
    await drawStroke(ana);
    await expect(ink(ana)).toHaveCount(1);
    await expect(ink(bea)).toHaveCount(1);
  });

  await test.step("moving my board does not move my cursor for the others", async () => {
    // the hand is picked first: going to its button moves the pointer, and that move is a real one
    await ana.getByTestId("tool-pan").click();
    const at: [number, number] = [700, 300];
    await ana.mouse.move(at[0] - 20, at[1]);
    await ana.mouse.move(at[0], at[1]);
    // where Ana's pointer is on the board, from her own screen
    const spot = await ana.evaluate(([x, y]) => {
      const svg = document.querySelector<SVGSVGElement>(".canvas2 svg")!;
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!.inverse());
      return { x: p.x, y: p.y };
    }, at);
    const off = async () => { const c = await cursorOf(bea, "Ana"); return c ? Math.hypot(c.x - spot.x, c.y - spot.y) : Infinity; };
    // Bea sees it there (cursors are sent a few times a second and eased)
    await expect.poll(off).toBeLessThan(1);

    const seen: number[] = [];
    await drag(ana, at, [at[0] + 240, at[1] + 160], async () => { await ana.waitForTimeout(60); seen.push(await off()); });
    await ana.waitForTimeout(300);
    seen.push(await off());
    // the board went 240 x 160 screen pixels; the pointer is still on the same spot of it
    expect(Math.max(...seen)).toBeLessThan(1);
  });

  await test.step("Clear clears for everyone", async () => {
    await ana.getByTestId("clear").click();
    await expect(ink(ana)).toHaveCount(0);
    await expect(ink(bea)).toHaveCount(0);
  });

  expectFree(paidAna);
  expectFree(paidBea);
});
