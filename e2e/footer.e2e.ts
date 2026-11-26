// The footer's last line: the company's notices, then the area and the company's pages elsewhere, kept together at
// its end however it wraps (site/src/components/Footer.astro).
import { expect, test } from "./support.ts";

// At about 900 px the company's icons fell alone to the left of a second line.
for (const width of [768, 900, 1024]) {
  test(`keeps the area and the icons together at the foot's line end at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/guides");
    const foot = page.locator("footer");
    const box = async (selector: string) => {
      const found = await foot.locator(selector).boundingBox();
      if (found === null) throw new Error(`no ${selector} in the footer`);
      return found;
    };
    const bottom = await box(".bottom");
    const area = await box(".area");
    const icons = await foot.locator(".social").evaluate((list) => {
      const rect = list.getBoundingClientRect();
      return {
        right: rect.right + parseFloat(getComputedStyle(list).marginRight),
        middle: rect.top + rect.height / 2,
      };
    });
    expect(Math.round(icons.right)).toBe(Math.round(bottom.x + bottom.width));
    expect(Math.abs(icons.middle - (area.y + area.height / 2))).toBeLessThan(area.height);
  });
}
