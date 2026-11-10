// What the technician's step tests share (steps*.e2e.ts): a time some minutes ago, a job started through to a step, the
// writes it sent, the checklist's lines and what is drawn in gold.

import type { Page } from "@playwright/test";
import { type Step } from "./fixtures.ts";
import { type Fake } from "./fake-tech.ts";

export const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A job checked in, started, and through the steps named. */
export function startedThrough(fake: Fake, ...steps: Step[]): void {
  fake.progress = {
    ...fake.progress,
    checked_in_at: ago(30),
    wait_ends_at: ago(15),
    distance_m: 40,
    started_at: ago(25),
    steps_done: steps,
  };
}

export const writesTo = (fake: Fake, step: string) => fake.writes.filter((write) => write.path.endsWith(`/${step}`));

/** The checklist's items, each a button in its own row of the list. */
export const checklistItems = (page: Page) => page.getByRole("listitem").getByRole("button");

/** How many things are marked in brass, the one mark a screen of the new look has: the step under way in the bar. */
export const brassMarks = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("body *")].filter((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.borderLeftColor].includes("rgb(185, 139, 69)");
      }).length,
  );

/** A hair system in the technician's kit, held under the one label given: what a fit goes on with. */
export const holding = (product: string, label: string): Fake["kitHairSystems"] => [
  {
    product,
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    code: `hs_${product}`,
    name: `Kit stock ${label}`,
    held: 1,
    units: [{ code: label, lot_code: null, expires_on: null }],
  },
];

/** A step's one action, in the bar at its foot: "Next: <the step after>", or the step's own words. */
export const stepAction = (page: Page) => page.locator("main > div").last().getByRole("button");
