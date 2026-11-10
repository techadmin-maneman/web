// Where each step's one action goes (docs/decisions/0245-the-steps.md): for every visit type it names the first step
// after it not yet sent, "Close visit" at the end, or the step's own words; Back opens the visit's plan; the tasks take
// a double tap as one; and a refused step opens as it was sent.

import { expect, test } from "../support.ts";
import { JOB_ID, type Step, type VisitType } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { queuedOnPhone } from "./on-phone.ts";
import { startedThrough, stepAction, writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { visit, steps } = techCopy;

/** A step of the visit: what was sent before it, and what its action says. */
type Stop = readonly [step: Step, sentBefore: readonly Step[], action: string];

const ALL_BEFORE_THE_CLOSE: readonly Step[] = ["before_photos", "checklist", "consumables", "after_photos"];

const VISITS: readonly { name: string; type: VisitType; oneVisit: boolean; stops: readonly Stop[] }[] = [
  {
    name: "a service",
    type: "service",
    oneVisit: false,
    stops: [
      ["checklist", ["before_photos"], visit.next(visit.screens.consumables)],
      ["consumables", ["before_photos", "checklist"], visit.next(visit.screens.after_photos)],
      ["outcome", ALL_BEFORE_THE_CLOSE, visit.close],
    ],
  },
  {
    name: "a replacement",
    type: "replacement",
    oneVisit: false,
    stops: [
      ["piece", ["before_photos"], visit.next(visit.screens.fitting)],
      ["checklist", ["before_photos", "piece"], visit.next(visit.screens.consumables)],
      ["consumables", ["before_photos", "piece", "checklist"], visit.next(visit.screens.after_photos)],
      ["outcome", [...ALL_BEFORE_THE_CLOSE, "piece"], visit.close],
    ],
  },
  {
    name: "a first fit",
    type: "first_fit",
    oneVisit: false,
    stops: [
      ["profile", ["before_photos"], visit.next(techCopy.profile.match.title)],
      ["piece", ["before_photos", "profile"], visit.next(visit.screens.fitting)],
      ["checklist", ["before_photos", "profile", "piece"], visit.next(visit.screens.consumables)],
      ["outcome", [...ALL_BEFORE_THE_CLOSE, "profile", "piece"], visit.close],
    ],
  },
  {
    name: "a consultation",
    type: "consultation",
    oneVisit: false,
    stops: [
      ["checklist", ["before_photos"], visit.next(visit.screens.hair_profile)],
      ["profile", ["before_photos", "checklist"], visit.next(techCopy.profile.match.title)],
      ["outcome", ["before_photos", "checklist", "profile"], visit.close],
    ],
  },
  {
    name: "a consultation and fit",
    type: "consultation",
    oneVisit: true,
    stops: [
      ["piece", ["before_photos", "profile"], visit.next(visit.screens.fitting)],
      ["checklist", ["before_photos", "profile", "piece"], visit.next(visit.screens.consumables)],
      ["outcome", [...ALL_BEFORE_THE_CLOSE, "profile", "piece"], visit.close],
    ],
  },
];

for (const { name, type, oneVisit, stops } of VISITS) {
  test(`on ${name}, each step’s action names the step it goes to`, async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = type;
    fake.oneVisit = oneVisit;
    for (const [step, sentBefore, action] of stops) {
      startedThrough(fake, ...sentBefore);
      await page.goto(`/jobs/${JOB_ID}/${step}`);
      // The tasks say "Next task" until the last.
      if (step === "checklist") await page.getByRole("button", { name: steps.checklist.all }).click();
      await expect(stepAction(page)).toHaveText(action);
    }
  });
}

test("the action passes over a step already sent", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "consumables");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: steps.checklist.all }).click();
  await expect(stepAction(page)).toHaveText(visit.next(visit.screens.after_photos));
});

test("a one visit closed as done says it sends the link", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.oneVisit = true;
  startedThrough(fake, ...ALL_BEFORE_THE_CLOSE, "profile", "piece");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("button", { name: steps.outcome.done, exact: true }).click();
  await expect(stepAction(page)).toHaveText(steps.outcome.sendLinkAndClose);
  await page.getByRole("button", { name: steps.outcome.partial, exact: true }).click();
  await expect(stepAction(page)).toHaveText(visit.close);
});

test("Back from a step opens the visit’s plan", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByText(visit.task(1, 3))).toBeVisible();
  await page.getByRole("button", { name: steps.back }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/plan$`));
});

test("a double tap on Next task moves one task", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByText(visit.task(1, 3))).toBeVisible();

  await stepAction(page).dblclick();

  await expect(page.getByText(visit.task(2, 3))).toBeVisible();
  // Once the task has arrived the action takes taps again, and the second tap moved nothing.
  await expect(stepAction(page)).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(visit.task(2, 3))).toBeVisible();
});

test("a list refused with every task done opens on its last task, ready to send", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await queuedOnPhone(page, [
    {
      id: "01000000-0000-7000-8000-00000000000d",
      kind: "checklist",
      route: "checklist",
      body: { done: ["piece_removed", "scalp_cleaned", "piece_cleaned"] },
      refused: { note: "invalid_request", fields: ["done"] },
    },
  ]);

  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByText(visit.task(3, 3))).toBeVisible();
  await expect(stepAction(page)).toHaveText(visit.next(visit.screens.consumables));
  await expect(stepAction(page)).toBeEnabled();
});

test("a refused close opens with its note and alert as written", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, ...ALL_BEFORE_THE_CLOSE);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  const written = { handoff_note: "Edge lifting at the left temple.", client_alert: "Allergic to latex." };
  await queuedOnPhone(page, [
    {
      id: "01000000-0000-7000-8000-00000000000e",
      kind: "outcome",
      route: "outcome",
      body: { outcome: "done", ...written },
      refused: { note: "invalid_request", fields: ["client_alert"] },
    },
  ]);

  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await expect(page.getByLabel(steps.outcome.nextNote)).toHaveValue(written.handoff_note);
  await expect(page.getByLabel(steps.outcome.alert)).toHaveValue(written.client_alert);
  await stepAction(page).click();
  await expect.poll(() => writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", ...written });
});
