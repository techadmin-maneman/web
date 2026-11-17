// A screen of the client app held at a phone's sizes (./large-text.e2e.ts, ./large-text-sheets.e2e.ts): 390 and 360
// px, and 360 with its text at 130% (docs/prompts/client-redesign.md, "Acceptance"). Nothing spills out of its box,
// as a name running into the next, and nothing scrolls sideways, the page itself included, but a row made to, which
// hides its bar: the photographs' angles and the booking's days. Larger text is drawn as the browser's zoom draws it,
// which grows the page's type and its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

/** Each size a screen is held at: its width, and how much its text is enlarged. */
export const SIZES = [
  { width: 390, zoom: 1 },
  { width: 360, zoom: 1 },
  { width: 360, zoom: 1.3 },
] as const;

export type Size = (typeof SIZES)[number];

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
    // set absolutely, as a count over an icon's corner, is placed so on purpose; the children of a box that clips or
    // scrolls are its own to hold, measured as it scrolls.
    const overrun = shown.flatMap((box) => {
      const parent = box.parentElement;
      if (parent === null || ["absolute", "fixed"].includes(getComputedStyle(box).position)) return [];
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return [];
      const [own, edge] = [box.getBoundingClientRect(), parent.getBoundingClientRect()];
      const out = own.width > 0 && (own.right > edge.right + 1 || own.left < edge.left - 1);
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
 * The screen measured at `size`, then its text set back to its own size, so the test can tap: a page zoomed in the
 * stylesheet is drawn where Playwright does not aim. Only what is measured is zoomed.
 */
export async function holds(page: Page, size: Size, what: string) {
  await page.setViewportSize({ width: size.width, height: 760 });
  if (size.zoom !== 1) await page.addStyleTag({ content: `html { zoom: ${String(size.zoom)}; }` });
  expect(await spills(page), what).toEqual({ spilled: [], sideways: false });
  await page.addStyleTag({ content: "html { zoom: 1; }" });
}

/** Signed in as the fitted client, before any page is asked for: one asked sooner is the sign-in screen. */
export async function signedIn(page: Page) {
  const fitted = fittedClient();
  await logIn(page, fitted.mobile);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  return fitted;
}
