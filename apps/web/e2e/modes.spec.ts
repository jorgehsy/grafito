// Changing mode: the tabs are never locked, and a mode takes its board, its script and its ink with it.
import { expect, test } from "@playwright/test";
import { drawStroke, expectDrawing, expectFree, expectModesOpen, ink, modeTab, open, zoneKinds } from "./app";

test("the mode tabs stay open while a script plays, and leaving stops it", async ({ page }) => {
  const paid = await open(page, "/?mode=demo&demo=data-model&auto=1");
  await expectDrawing(page);
  await expectModesOpen(page);

  await modeTab(page, "architect").click();
  await expect(modeTab(page, "architect")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("script-bar")).toHaveCount(0);
  // the script is stopped, not only hidden: nothing more lands on the new mode's board
  await page.waitForTimeout(1500);
  expect(await zoneKinds(page)).toEqual(["system"]);
  await expectModesOpen(page);
  expectFree(paid);
});

test("the mode tabs stay open at the end of a script", async ({ page }) => {
  const paid = await open(page, "/?mode=demo&demo=data-model&auto=1");
  await expectDrawing(page);
  const timeline = page.getByTestId("script-timeline");
  await timeline.focus();
  await page.keyboard.press("End");
  await expectModesOpen(page);
  // Space still works with the timeline focused
  await page.keyboard.press("Space");
  await expectModesOpen(page);
  await modeTab(page, "live").click();
  await expect(modeTab(page, "live")).toHaveAttribute("aria-pressed", "true");
  expectFree(paid);
});

test("ink leaves with the mode it was drawn in", async ({ page }) => {
  const paid = await open(page, "/?mode=live");
  await expect(page.getByTestId("start-hint")).toBeVisible();
  await drawStroke(page);
  await expect(ink(page)).toHaveCount(1);
  await expect(page.getByTestId("start-hint")).toHaveCount(0);

  await modeTab(page, "architect").click();
  await expect(ink(page)).toHaveCount(0);
  await modeTab(page, "live").click();
  await expect(ink(page)).toHaveCount(0);
  await expect(page.getByTestId("start-hint")).toBeVisible();
  expectFree(paid);
});

test("Clear starts from zero: the board and the ink", async ({ page }) => {
  const paid = await open(page, "/?mode=live");
  await drawStroke(page);
  await drawStroke(page, [600, 300], [900, 340]);
  await expect(ink(page)).toHaveCount(2);

  await page.getByTestId("clear").click();
  await expect(ink(page)).toHaveCount(0);
  await expect(page.getByTestId("start-hint")).toBeVisible();
  expectFree(paid);
});
