// What axe cannot see (A11Y-23): whether a focused control is drawn as focused
// (WCAG 2.4.7), whether it is hidden under the fixed header or the sticky bar
// (2.4.11), and whether a page reflows into 320 px without scrolling sideways
// (1.4.10). Each of these was broken on 24 September 2026 while every axe run
// passed (A11Y-03, 08, 09).

import type { Locator, Page } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

/** Room around a drawn control for a focus ring outside it: an outline and its offset. */
const RING_ROOM = 8;

/**
 * The control's drawing, with room around it, before and after it takes the
 * keyboard's focus. A key press first, so the browser treats the focus as the
 * keyboard's, as it is for someone tabbing, and draws :focus-visible.
 */
async function drawnBeforeAndAfterFocus(page: Page, control: Locator, drawn: Locator): Promise<[Buffer, Buffer]> {
  await page.keyboard.press("Shift");
  await drawn.scrollIntoViewIfNeeded();
  const box = await drawn.boundingBox();
  if (box === null) throw new Error("the control is not drawn");
  const clip = {
    x: Math.max(0, box.x - RING_ROOM),
    y: Math.max(0, box.y - RING_ROOM),
    width: box.width + 2 * RING_ROOM,
    height: box.height + 2 * RING_ROOM,
  };
  const before = await page.screenshot({ clip, animations: "disabled" });
  await control.focus();
  expect(await control.evaluate((input) => input.matches(":focus-visible"))).toBe(true);
  const after = await page.screenshot({ clip, animations: "disabled" });
  return [before, after];
}

test.describe("the booking form's own controls show where the keyboard is", () => {
  for (const path of ["/book?state=served", "/r/RM4K7P?state=served"]) {
    test(`on ${path}: every date, window, hair-loss choice and consent box`, async ({ page }) => {
      await visit(page, path);
      const controls = page.locator("form").locator('input[type="radio"], input[type="checkbox"]');
      await expect(controls.first()).toBeAttached();
      const seen = new Set<string>();
      for (const control of await controls.all()) {
        // One of each radio group: the group's radios are drawn alike.
        const group = (await control.getAttribute("name")) ?? "";
        const kind = `${(await control.getAttribute("type")) ?? ""}:${group}`;
        if (seen.has(kind) || !(await control.isEnabled())) continue;
        seen.add(kind);
        const drawn = control.locator("xpath=ancestor::label[1]");
        const [before, after] = await drawnBeforeAndAfterFocus(page, control, drawn);
        expect(after.equals(before), `${kind} looks the same focused as not`).toBe(false);
      }
      expect(seen.size).toBeGreaterThan(2);
    });
  }
});

/** Whether the focused element's middle is its own, not the header's or the sticky bar's drawn over it. */
function focusIsInSight(page: Page): Promise<{ what: string; inSight: boolean } | null> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return null;
    const box = focused.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    const what = `${focused.tagName.toLowerCase()} "${focused.innerText.trim().slice(0, 40)}"`;
    return { what, inSight: top !== null && (focused.contains(top) || top.contains(focused)) };
  });
}

test("no control the keyboard reaches on the home page is hidden under the header or the sticky bar", async ({
  page,
}) => {
  await page.goto("/");
  const hidden: string[] = [];
  let previous = "";
  for (let stop = 0; stop < 120; stop += 1) {
    await page.keyboard.press("Tab");
    const seen = await focusIsInSight(page);
    if (seen === null) continue;
    if (seen.what === previous) break;
    previous = seen.what;
    if (!seen.inSight) hidden.push(seen.what);
  }
  expect(hidden).toEqual([]);
});

test("the pages reflow into 320 px, with nothing to scroll sideways", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "the width is set here, so one project is enough");
  await page.setViewportSize({ width: 320, height: 640 });
  const wide: string[] = [];
  for (const path of ["/", "/try", "/book", "/book?state=served", "/r/RM4K7P", "/r/RM4K7P?state=served"]) {
    if (path === "/") await page.goto(path);
    else await visit(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) wide.push(`${path} is ${String(overflow)} px too wide`);
  }
  expect(wide).toEqual([]);
});
