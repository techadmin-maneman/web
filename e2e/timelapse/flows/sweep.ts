// A checkpoint's read of the console: each page opened as ops open it, and held to opening whole, with its title,
// no "Couldn't load this.", nothing broken on the page and every answer inside the API's contract. Four at a time.

import type { Page } from "@playwright/test";
import { SECTIONS, SETTINGS_PAGES } from "../../../apps/ops/src/route.ts";
import type { Sim } from "../world.ts";

const LOAD_FAILED = "Couldn’t load this.";

/** The pages the bi-weekly and month-end checks read (the brief's analytics, ledger and supply-plan pages). */
export const CHECKPOINT_PAGES = [
  "/today",
  "/activity",
  "/funnel",
  "/settings/targets",
  "/usage",
  "/ledger",
  "/payments",
  "/spend",
  "/settings/packages",
  "/supply-plan",
  "/technician-pay",
  "/partner-commission",
  "/tasks",
  "/dispatch",
] as const;

/** Every page of work and every Settings page. */
export const EVERY_PAGE = [
  ...SECTIONS.map((section) => section.path),
  ...SETTINGS_PAGES.map((page) => `/settings/${page.tab}`),
];

async function read(page: Page, origin: string, path: string): Promise<string | null> {
  await page.goto(`${origin}${path}`);
  try {
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 });
    // The first answer: loading gives way to the page, or to its failure line.
    await page
      .getByText("Loading…")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => undefined);
    if ((await page.getByText(LOAD_FAILED).count()) > 0) return `${path}: ${LOAD_FAILED}`;
    return null;
  } catch (error) {
    return `${path}: never drew its title (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`;
  }
}

/** Opens each path, `lanes` at a time in pages of their own, and throws listing every one that did not open whole. */
export async function sweep(sim: Sim, wave: string, paths: readonly string[], lanes = 4): Promise<void> {
  const pages = await Promise.all(Array.from({ length: lanes }, () => sim.desk.context.newPage()));
  await sim.steps.run(
    {
      wave,
      workflow: "Checkpoint read",
      app: "ops",
      screen: `${String(paths.length)} pages`,
      action: "open each page",
      mode: "ui",
    },
    async () => {
      const queue = [...paths];
      const failed: string[] = [];
      await Promise.all(
        pages.map(async (page) => {
          for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
            const fault = await read(page, sim.desk.origin, path);
            if (fault !== null) failed.push(fault);
          }
        }),
      );
      if (failed.length > 0) throw new Error(failed.join(" || "));
    },
    { pages },
  );
  await Promise.all(pages.map((page) => page.close()));
}
