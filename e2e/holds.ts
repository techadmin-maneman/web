// A screen held at a size (./app/text-sizes.ts for the client app's, ./site-sizes.e2e.ts for the site's): nothing
// spills out of its box, as a name running into the next, and nothing scrolls sideways, the page itself included, but a
// row made to, which hides its bar. Larger text is drawn as the browser's zoom draws it, which grows the page's type and
// its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { expect } from "./support.ts";

/** A width, and how much the text is enlarged: 1 for none, 1.3 for 130%. */
export interface Size {
  readonly width: number;
  readonly zoom: number;
}

export const named = (size: Size) => `${String(size.width)} px, text at ${String(size.zoom * 100)}%`;

/**
 * What spills, or scrolls sideways, anywhere on the page: its header, the offline bar beneath it, its body, its footer,
 * its tabs and any sheet open on it. Words spill when they run out of the box they are in, as a name into the next, and
 * a box when it runs past its parent's edge; a count set over an icon's corner on purpose is no spill, being placed
 * so. A box scrolls sideways when it is a scroller whose bar shows, as the page's main or a sheet's body; a row made to
 * scroll sideways hides its bar, as the photographs' angles and the booking's days. Words kept for a screen reader
 * alone (packages/ui/VisuallyHidden.tsx) are out of sight.
 */
function spills(page: Page) {
  return page.evaluate(() => {
    const unseen = (node: Element | null): boolean =>
      node !== null && (getComputedStyle(node).clipPath === "inset(50%)" || unseen(node.parentElement));
    const shown = [...document.querySelectorAll<HTMLElement>("body *")].filter(
      (box) => box.closest("svg") === null && !unseen(box),
    );
    const spilled = shown.flatMap((box) => {
      // A field's words are its value, drawn inside it and scrolled there, never laid out as the page's own; its box is
      // still held to its parent's edge below.
      if (["TEXTAREA", "SELECT"].includes(box.tagName)) return [];
      const own = [...box.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (own.length === 0) return [];
      const words = document.createRange();
      words.setStartBefore(own[0] as Node);
      words.setEndAfter(own.at(-1) as Node);
      const [text, edge] = [words.getBoundingClientRect(), box.getBoundingClientRect()];
      const out = text.right > edge.right + 1 || text.left < edge.left - 1;
      return out ? [`${box.tagName.toLowerCase()} "${box.textContent.trim().slice(0, 40)}"`] : [];
    });
    // A box running past its parent's edge, as a row of buttons wider than its card, though each keeps its words. A box
    // set absolutely, as a count over an icon's corner, is placed so on purpose, as is one its own negative margin pulls
    // out as far as the margin, as a bar drawn to the screen's edges; the children of a box that clips or scrolls are
    // its own to hold, measured as it scrolls. A parent that draws no box of its own (display: contents) is passed
    // through to the one that does. A margin is read unzoomed and a box measured zoomed, so the margin is zoomed too.
    const boxed = (node: HTMLElement | null): HTMLElement | null =>
      node !== null && getComputedStyle(node).display === "contents" ? boxed(node.parentElement) : node;
    const overrun = shown.flatMap((box) => {
      const parent = boxed(box.parentElement);
      const style = getComputedStyle(box);
      if (parent === null || ["absolute", "fixed"].includes(style.position)) return [];
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return [];
      const [own, edge] = [box.getBoundingClientRect(), parent.getBoundingClientRect()];
      const zoom = box.currentCSSZoom;
      const pulledRight = Math.max(0, -parseFloat(style.marginRight)) * zoom;
      const pulledLeft = Math.max(0, -parseFloat(style.marginLeft)) * zoom;
      const pastRight = own.right > edge.right + pulledRight + 1;
      const pastLeft = own.left < edge.left - pulledLeft - 1;
      const out = own.width > 0 && (pastRight || pastLeft);
      return out ? [`${box.tagName.toLowerCase()} "${box.textContent.trim().slice(0, 40)}" past its box`] : [];
    });
    const scrolling = shown
      .filter((box) => {
        const style = getComputedStyle(box);
        const scroller = style.overflowX === "auto" || style.overflowX === "scroll";
        return scroller && style.scrollbarWidth !== "none" && box.scrollWidth > box.clientWidth + 1;
      })
      .map((box) => `${box.tagName.toLowerCase()} scrolls sideways`);
    return {
      spilled: [...spilled, ...overrun, ...scrolling],
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/**
 * The screen measured at `size`, then its text set back to its own size, so the test can tap: a page zoomed is drawn
 * where Playwright does not aim. Only what is measured is zoomed, through the page's own style, which a policy that
 * refuses an added stylesheet, as the site's does, still lets a script set.
 */
export async function holds(page: Page, size: Size, what: string) {
  await page.setViewportSize({ width: size.width, height: 760 });
  const zoom = (by: number) =>
    page.evaluate((value) => {
      document.documentElement.style.zoom = value === 1 ? "" : String(value);
    }, by);
  await zoom(size.zoom);
  expect(await spills(page), what).toEqual({ spilled: [], sideways: false });
  await zoom(1);
}
