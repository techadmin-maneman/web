// No box in a table (docs/decisions/0212-editing-in-place.md): checked on the page as it is drawn, with whatever form
// or drawer the spec has open. A form's short boxes may share a line, on the form's grid
// (docs/decisions/0314-change-everywhere-and-forms-in-a-grid.md).

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";

/** The labels of the boxes inside a table's cells. */
function boxesInTables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SKIPPED = ["hidden", "checkbox", "radio", "file"];
    const boxes = [...document.querySelectorAll<HTMLElement>("input, select, textarea")].filter((box) => {
      if (box instanceof HTMLInputElement && SKIPPED.includes(box.type)) return false;
      return box.getClientRects().length > 0;
    });
    const nameOf = (box: HTMLElement) =>
      (box as HTMLInputElement).labels?.[0]?.textContent.trim() ?? box.getAttribute("aria-label") ?? box.tagName;
    return boxes.filter((box) => box.closest("td, th") !== null).map(nameOf);
  });
}

/** Fails, naming the boxes, where a box sits in a table. */
export async function expectNoBoxInATable(page: Page, where: string): Promise<void> {
  expect(await boxesInTables(page), where).toEqual([]);
}
