// The site redesign's boards (design/site-redesign/boards, ADR 0262) as the fidelity runs open them
// (scripts/fidelity/fidelity.ts, fidelity-refer.ts): their pictures answered from the repository's own files, the
// canvas's runtime and libraries from node_modules, a board unrolled to its full length, and /book's board walked to
// each of its states as a visitor would (ADR 0265).
import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { routeDesignLibraries, STILL } from "./fidelity.ts";

/** Each board's picture, from the README's table: `| \`<id>\` | \`<file>` …`. */
const BLOBS: ReadonlyMap<string, string> = new Map(
  [...readFileSync("design/site-redesign/README.md", "utf8").matchAll(/^\| `([0-9a-f]{32})` \| `([^` (]+)/gm)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  ),
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
};

/** A page that can open the boards at `design`, the boards' own folder as a server answers it. */
export async function preparePage(browser: Browser, design: string, width: number, height: number): Promise<Page> {
  // The site's content security policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({ viewport: { width, height }, bypassCSP: true });
  await page.route("**/*.mp4", (route) => route.abort());
  // The try-on readies Turnstile as it opens; here it gets one that passes.
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'window.turnstile = { render: () => "fake", reset() {} };' }),
  );
  await routeDesignLibraries(page);
  // The boards load the canvas's runtime beside them; it is the one in design/.
  await page.route(`${design}/support.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync("design/support.js") }),
  );
  await page.route("**/_blob/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const file = BLOBS.get(id);
    if (file === undefined || file.endsWith(".mp4")) return route.abort();
    return route.fulfill({
      body: readFileSync(file),
      contentType: CONTENT_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
    });
  });
  return page;
}

export async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Load every lazy image: walk down the page, then back to the top.
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 40));
    }
    window.scrollTo(0, 0);
    // Every image settles, loaded or not, within five seconds.
    const images = [...document.images]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((done) => {
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
          }),
      );
    await Promise.race([Promise.all(images), new Promise((done) => setTimeout(done, 5000))]);
  });
}

/**
 * Opens a board and unrolls it: the board's frame and the page scrolling inside it take their full length. `before`
 * acts on the board first, to bring it to a state.
 */
export async function openBoard(
  page: Page,
  design: string,
  board: string,
  before?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto(`${design}/${board}.dc.html`, { waitUntil: "networkidle" });
  await page.locator(".mm:visible").first().waitFor();
  if (before !== undefined) await before(page);
  await page.evaluate(() => {
    const root = [...document.querySelectorAll<HTMLElement>(".mm")].find(
      (element) => element.getClientRects().length > 0,
    );
    if (root === undefined) return;
    // The page's own scroller is screen-tall; a row of cards or a table that scrolls inside it is not. Where each sits
    // is read before anything moves, since a computed style changes as the element's own style does.
    const scrollers = [...root.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (style.overflowY === "auto" || style.overflowY === "scroll") && element.clientHeight >= 300;
      })
      .map((element) => ({
        element,
        absolute: getComputedStyle(element).position === "absolute",
        top: element.offsetTop,
        padding: parseFloat(getComputedStyle(element).paddingTop),
      }));
    // At least the board's own height, where its page is shorter than the screen it is drawn on.
    root.style.minHeight = `${String(root.getBoundingClientRect().height)}px`;
    root.style.height = "auto";
    root.style.overflow = "visible";
    for (const { element, absolute, top, padding } of scrollers) {
      element.style.position = "static";
      element.style.overflow = "visible";
      element.style.height = "auto";
      element.style.flex = "none";
      // Below the board's header, which stays where the board draws it. Padding, since a margin would pass through
      // the root, now overflowing, and carry the header down with it.
      if (absolute) element.style.paddingTop = `${String(padding + top)}px`;
    }
  });
  await settle(page);
}

/** /book's states as its board draws them, and the steps a visitor takes on the board to reach each. */
export type BookBoardState = "you" | "area" | "visit" | "address" | "nots" | "listed" | "done";

/**
 * Walks /book's board to a state, as a visitor would: the name and number, the pincode (Sector 65's for a visit,
 * Bandra's for the list), a start, the address, and the WhatsApp code the board takes any six digits for.
 */
export async function bookBoardAt(page: Page, state: BookBoardState): Promise<void> {
  if (state === "you") return;
  // The board draws its frames more than once; the one shown is acted on.
  const board = page.locator(".mm:visible").first();
  await board.locator("#nm").fill("Rahul");
  await board.locator("#mob").fill("9810000000");
  // The box itself: the line beside it holds links.
  await board
    .getByRole("checkbox", { name: /I agree to the/ })
    .locator(".bx")
    .click();
  await board.getByRole("button", { name: /Book your free consultation/ }).click();
  if (state === "area") return;
  const listed = state === "nots" || state === "listed";
  await board.locator("#pin").fill(listed ? "400050" : "122018");
  await board.getByRole("button", { name: "Check", exact: true }).click();
  if (state === "visit" || state === "nots") return;
  if (state === "listed") {
    await board
      .getByRole("checkbox", { name: /You may contact me/ })
      .locator(".bx")
      .click();
    await board.getByRole("button", { name: "Add me to the list" }).click();
    return;
  }
  await board.locator(".slot:not([disabled])").first().click();
  await board.getByRole("button", { name: "Continue", exact: true }).click();
  if (state === "address") return;
  await board.locator("#flat").fill("B-1204");
  await board.locator("#bld").fill("Palm Grove Society");
  await board.getByRole("button", { name: "Book the consultation" }).click();
  await board.locator(".otp input").fill("123456");
  await board.getByRole("button", { name: "Confirm and book" }).click();
}
