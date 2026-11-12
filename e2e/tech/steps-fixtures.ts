// What the technician's step tests share (steps*.e2e.ts): a time some minutes ago, a job started through to a step, the
// writes it sent, the checklist's lines and what is drawn in gold.

import { expect, type Page } from "@playwright/test";
import { capture, visit } from "../../apps/tech/src/content.ts";
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

/** The angles in the order the camera takes them (apps/tech/src/lib/sets.ts). */
const ANGLE_ORDER = ["front", "top", "left", "right", "hair"] as const;

/** What the camera's head says once `taken` angles are: the shot being taken, "2 of 5 · Top", or "5 of 5" once done. */
export const shots = (taken: number): string => {
  const next = ANGLE_ORDER[taken];
  return next === undefined ? capture.of(taken) : capture.taking(taken + 1, capture.angles[next]);
};

/**
 * Through a visit's guided tasks to the last, by Next task: each task once, as the technician works them. The step's
 * own action, on the last, is the caller's to tap.
 */
export async function throughTheTasks(page: Page): Promise<void> {
  const count = page.getByText(/^Task \d+ of \d+$/);
  const total = Number(/of (\d+)$/.exec((await count.textContent()) ?? "")?.[1] ?? "1");
  for (let at = 1; at < total; at += 1) {
    await expect(count).toHaveText(visit.task(at, total));
    await page.getByRole("button", { name: visit.nextTask }).click();
  }
  await expect(count).toHaveText(visit.task(total, total));
}

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
