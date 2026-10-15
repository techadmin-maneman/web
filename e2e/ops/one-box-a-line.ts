// One field to a line, and none in a table (docs/patterns.md): checked on the page as it is drawn, with whatever form
// or drawer the spec has open. A toolbar's filters are the one row of boxes, so they are left out.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";

interface Misplaced {
  /** Boxes whose top edge is level with another box of the same form, by their labels. */
  readonly sharingALine: string[];
  /** Boxes inside a table's cells, by their labels. */
  readonly inTables: string[];
}

function misplacedBoxes(page: Page): Promise<Misplaced> {
  return page.evaluate(() => {
    const SKIPPED = ["hidden", "checkbox", "radio", "file"];
    const boxes = [...document.querySelectorAll<HTMLElement>("input, select, textarea")].filter((box) => {
      if (box instanceof HTMLInputElement && SKIPPED.includes(box.type)) return false;
      if (box.closest("[role=search]") !== null) return false;
      return box.getClientRects().length > 0;
    });
    const nameOf = (box: HTMLElement) =>
      (box as HTMLInputElement).labels?.[0]?.textContent.trim() ?? box.getAttribute("aria-label") ?? box.tagName;

    // A drawer's boxes are one form, and so are a panel's.
    const byForm = new Map<Element, HTMLElement[]>();
    for (const box of boxes) {
      const form = box.closest("dialog") ?? box.closest("section") ?? document.body;
      byForm.set(form, [...(byForm.get(form) ?? []), box]);
    }
    const sharingALine = [...byForm.values()].flatMap((inForm) =>
      inForm.filter((box) =>
        inForm.some(
          (other) => other !== box && Math.abs(other.getBoundingClientRect().top - box.getBoundingClientRect().top) < 4,
        ),
      ),
    );
    return {
      sharingALine: sharingALine.map(nameOf),
      inTables: boxes.filter((box) => box.closest("td, th") !== null).map(nameOf),
    };
  });
}

/** Fails, naming the boxes, where two boxes of one form share a line or a box sits in a table. */
export async function expectOneBoxALine(page: Page, where: string): Promise<void> {
  expect(await misplacedBoxes(page), where).toEqual({ sharingALine: [], inTables: [] });
}
