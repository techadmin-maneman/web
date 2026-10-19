// The buttons on a page whose words run onto a second line: a label too long for its button, which a phone shows
// as two ragged lines. Words a screen reader alone hears, in a box a pixel wide, are not drawn and do not count.

import type { Page } from "@playwright/test";

/** Each drawn button, or link drawn as one, whose words take more than one line: its words and width. */
export function wrappedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const control of document.querySelectorAll<HTMLElement>('button, [role="button"], a[class*="button" i]')) {
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(control).visibility === "hidden") continue;
      const tops: number[] = [];
      const words = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      for (let node = words.nextNode(); node !== null; node = words.nextNode()) {
        if ((node.textContent ?? "").trim() === "" || (node.parentElement?.getBoundingClientRect().width ?? 0) <= 1) {
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const line of range.getClientRects()) {
          if (line.width > 1 && !tops.some((top) => Math.abs(top - line.top) < 6)) tops.push(line.top);
        }
      }
      if (tops.length > 1) found.push(`"${control.innerText.trim()}", ${String(Math.round(box.width))} px wide`);
    }
    return found;
  });
}
