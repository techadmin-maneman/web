// Before any test runs: the builds the run will be served are checked against
// their source, then a fitted client in the local mirrors, for the client app's
// read surfaces (e2e/app/fitted.ts), a fitted client with an address, who books
// (e2e/app/booker.ts), two clients whose visits the change tests move and cancel
// (e2e/app/changing.ts), three clients the app offers their next visit to
// (e2e/app/next-visit.ts), a client with a try-on from the site
// (e2e/app/try-on.ts), and the service area the booking pages read
// (e2e/booking-area.ts).

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { seedBooker } from "./app/booker.ts";
import { seedChanging } from "./app/changing.ts";
import { seedFitted } from "./app/fitted.ts";
import { seedNextVisit } from "./app/next-visit.ts";
import { seedTryOn } from "./app/try-on.ts";
import { seedBookingArea } from "./booking-area.ts";

/** Each surface playwright.config.ts serves, and the command that builds it. */
const SURFACES = [
  { root: "site", build: "npm run build:site" },
  { root: "apps/app", build: "npm run build:app" },
  { root: "apps/ops", build: "npm run build:ops" },
  { root: "apps/tech", build: "npm run build:tech" },
] as const;

/** The newest change under a directory. Builds, packages and caches are not source. */
function newestUnder(directory: string): number {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestUnder(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * The browser tests are served whatever is on disk: Playwright runs the serve
 * scripts and never builds. A build left behind its source answers every page
 * with an older app, and the tests then fail one screen at a time, each with a
 * message about its own screen and none about the build. This says it once.
 *
 * Every run is checked against all four, because every run starts all four
 * servers whichever projects it names. It compares them by timestamp, so it
 * catches a checkout or an edit the build has not caught up with, which is what
 * goes stale in practice; a change to shared code outside a surface passes it.
 */
function checkBuilds(): void {
  const behind: string[] = [];
  for (const { root, build } of SURFACES) {
    const built = `${root}/dist/local`;
    if (!existsSync(built)) behind.push(`${built} is not built`);
    else if (newestUnder(root) > newestUnder(built)) behind.push(`${built} is older than ${root}/`);
    else continue;
    behind.push(`  ${build} -- --env local`);
  }
  if (behind.length > 0) {
    throw new Error(`the tests would be served a stale build:\n${behind.join("\n")}`);
  }
}

export default async function globalSetup(): Promise<void> {
  checkBuilds();
  await seedFitted();
  await seedBooker();
  await seedChanging();
  await seedNextVisit();
  await seedTryOn();
  await seedBookingArea();
}
