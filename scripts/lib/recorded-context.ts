// A browser context that records an audit's walkthrough on staging: each workflow's video filed under
// videos/staging/ by who walks it, the client, the technician or a member of staff by role, and the workflow, as
// npm run e2e:videos files the browser tests' (e2e/video-reporter.ts).
//
//   const walk = await recordedContext(browser, { who: "staff", role: "Finance", workflow: "Refund a cancelled visit" });
//   const page = await walk.context.newPage();
//   …
//   const files = await walk.finish();

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test";

/** Who walks a workflow, and which. */
interface Walk {
  readonly who: "customer" | "technician" | "staff";
  /** A member of staff's role, "Finance"; left out for a client or a technician. */
  readonly role?: string;
  readonly workflow: string;
}

/** A file name of a title: lower case, words joined by dashes. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

/** The context, recording each page opened in it; `finish` closes it and answers where each video was filed. */
export async function recordedContext(
  browser: Browser,
  walk: Walk,
  options: BrowserContextOptions = {},
): Promise<{ readonly context: BrowserContext; readonly finish: () => Promise<string[]> }> {
  const folder = join("videos", "staging", walk.who, ...(walk.role === undefined ? [] : [slug(walk.role)]));
  mkdirSync(folder, { recursive: true });
  const size = options.viewport ?? undefined;
  const context = await browser.newContext({
    ...options,
    recordVideo: { dir: folder, ...(size === undefined ? {} : { size }) },
  });
  const finish = async (): Promise<string[]> => {
    const pages = context.pages();
    await context.close();
    const files: string[] = [];
    for (const [index, page] of pages.entries()) {
      const video = page.video();
      if (video === null) continue;
      const file = join(folder, `${slug(walk.workflow)}${pages.length > 1 ? `-${String(index + 1)}` : ""}.webm`);
      await video.saveAs(file);
      await video.delete();
      files.push(file);
    }
    return files;
  };
  return { context, finish };
}
