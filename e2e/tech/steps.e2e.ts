// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ONE_VISIT_CHECKLIST } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { atTheDoor, deviceRecordOnPhone, heldOnPhone, pageScrolls, queuedOnPhone, recordOnPhone } from "./on-phone.ts";
import { holding, startedThrough, writesTo, brassMarks, throughTheTasks } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { stepAction } from "./steps-fixtures.ts";

/** A step's one action, in the foot below its body. */
const footAction = (page: Page) => page.locator("main > div").last().getByRole("button");

test("a double tap on Start job starts the job once", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();

  await page.getByRole("button", { name: techCopy.job.start }).dblclick();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.before_photos })).toBeVisible();
  await expect.poll(() => writesTo(fake, "start").length).toBe(1);
  // And nothing else was queued behind it: the phone holds nothing more to send.
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
  expect(writesTo(fake, "start")).toHaveLength(1);
});

test("each screen names itself in the title and takes the focus to its heading", async ({ page }) => {
  await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page).toHaveTitle("Rohit M. · Mane Man technician");

  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await page.getByRole("button", { name: techCopy.job.start }).click();
  await expect(page).toHaveTitle("Before photos · Mane Man technician");
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.before_photos })).toBeFocused();
});

test("a double tap on Next finishes one step, and never the step it opens", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  await throughTheTasks(page);

  await stepAction(page).dblclick();

  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.consumables })).toBeVisible();
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
  expect(writesTo(fake, "checklist")).toHaveLength(1);
  // The consumables' Next sits where the checklist's was, and the second tap did not reach it.
  expect(writesTo(fake, "consumables")).toHaveLength(0);
});

test("the outcome has nothing chosen for the technician, and Next waits for their choice", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);

  const done = page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true });
  await expect(done).not.toBeChecked();
  await expect(page.getByText(techCopy.steps.outcome.choose, { exact: true })).toBeVisible();
  await expect(stepAction(page)).toBeDisabled();

  await done.check();
  await expect(done).toBeChecked();
  await stepAction(page).click();
  await expect(page.getByText(techCopy.closeOut.sub("Rohit M.", "service visit", "done"))).toBeVisible();
  expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done" });
});

// After a consultation, the outcome asks whether the client is going ahead, and why not (docs/decisions/0149-lost-reasons.md).
test("times the visit from the check-in to the close", async ({ page }) => {
  const fake = await fakeTech(page);
  // Checked in thirty minutes ago, and started five minutes after.
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).check();
  await stepAction(page).click();
  await expect(page.getByText(techCopy.closeOut.duration)).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.length(0, 30), { exact: true })).toBeVisible();
});

test("a consultation’s outcome asks whether the client is going ahead, and why not", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  // The outcome opens on the consultation's Options; a pick goes only with a yes.
  await page.getByRole("button", { name: /^Mane Man Essential/ }).click();
  await stepAction(page).click();

  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  await expect(page.getByText(techCopy.steps.outcome.goingAhead)).toBeVisible();
  await page.getByRole("button", { name: techCopy.steps.outcome.notNow }).click();
  await expect(page.getByText(techCopy.steps.outcome.pickWhy, { exact: true })).toBeVisible();
  await expect(stepAction(page)).toBeDisabled();
  await page.getByRole("button", { name: "The price" }).click();
  await stepAction(page).click();

  await expect
    .poll(() => writesTo(fake, "outcome").at(-1)?.body)
    .toEqual({ outcome: "done", lost_reason: "price", going_ahead: false });
  // The close-out repeats what was decided.
  await expect(page.getByText(techCopy.closeOut.notNow("The price"))).toBeVisible();
});

// A yes was sent as nothing at all, so the console could not tell it from a question never asked.
test("a consultation’s outcome sends the client’s yes", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  // Nothing picked on Options: the yes goes alone.
  await stepAction(page).click();

  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  // Unanswered, the question holds Next back: it is never recorded as a yes by default.
  await expect(page.getByText(techCopy.steps.outcome.answerFirst, { exact: true })).toBeVisible();
  await expect(stepAction(page)).toBeDisabled();
  await page.getByRole("button", { name: techCopy.steps.outcome.yes }).click();
  await stepAction(page).click();
  await expect.poll(() => writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", going_ahead: true });
});

// The client's pick on Options goes with their yes, and ops see it on the First fit to book task (ADR 0247).
test("a consultation’s outcome opens on Options, and the client’s pick goes with their yes", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);

  await expect(page.getByRole("heading", { level: 1, name: techCopy.options.title })).toBeVisible();
  await expect(page.getByText(techCopy.options.markPick)).toBeVisible();
  // Prices come with signal; the products are the card's.
  await expect(page.getByText("Rs. 37,760")).toBeVisible();
  await expect(stepAction(page)).toHaveText(techCopy.visit.next(techCopy.steps.titles.outcome));
  expect(await axeViolations(page)).toEqual([]);

  const natural = page.getByRole("button", { name: /^Mane Man Natural/ });
  await natural.click();
  await expect(natural).toHaveAttribute("aria-pressed", "true");
  await stepAction(page).click();

  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  await page.getByRole("button", { name: techCopy.steps.outcome.yes }).click();
  await expect(page.getByText(techCopy.steps.outcome.picked("Mane Man Natural"))).toBeVisible();
  // Back on Options the pick is as it was left.
  await page.getByRole("button", { name: techCopy.steps.back }).click();
  await expect(natural).toHaveAttribute("aria-pressed", "true");
  await stepAction(page).click();
  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  await page.getByRole("button", { name: techCopy.steps.outcome.yes }).click();
  await stepAction(page).click();

  await expect
    .poll(() => writesTo(fake, "outcome").at(-1)?.body)
    .toEqual({ outcome: "done", going_ahead: true, product: "natural" });
});

test("sends the whole checklist done once the last task is through, and shows how far through the job", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByText(/^Step 2 of \d+$/)).toBeVisible();
  await throughTheTasks(page);
  await stepAction(page).click();
  await expect
    .poll(() => writesTo(fake, "checklist").at(-1)?.body)
    .toEqual({ done: ["piece_removed", "scalp_cleaned", "piece_cleaned"] });
});

test("steps a measure by five and takes a typed count, landing back on the fives", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist");
  await page.goto(`/jobs/${JOB_ID}/consumables`);
  await page.getByRole("button", { name: "5 ml more solvent" }).click();
  await expect(page.getByRole("button", { name: "Type the solvent used" })).toHaveText("15");
  await page.getByRole("button", { name: "Type the solvent used" }).click();
  await page.getByRole("spinbutton", { name: "Type the solvent used" }).fill("32");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "5 ml less solvent" }).click();
  await stepAction(page).click();
  await expect
    .poll(() => writesTo(fake, "consumables").at(-1)?.body)
    .toEqual({
      items: [
        { code: "tape_strips", quantity: 4 },
        { code: "solvent", quantity: 30 },
      ],
    });
});

// The brief: "brass-500, the one highlight per screen". On a step it is the step under way, in the bar.
test("marks only the step under way in brass", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByText(techCopy.visit.task(1, 3))).toBeVisible();
  await throughTheTasks(page);
  await expect(stepAction(page)).toBeEnabled();
  expect(await brassMarks(page)).toBe(1);
  expect(await axeViolations(page)).toEqual([]);

  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("radio", { name: techCopy.steps.outcome.partial, exact: true }).click();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  expect(await brassMarks(page)).toBe(1);
  expect(await axeViolations(page)).toEqual([]);
});

test("opens on the task it was on when the app closes part-way, and lets it go once sent", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  // One task a screen, and no tick on any: on to the second.
  await stepAction(page).click();
  await expect.poll(() => deviceRecordOnPhone(page, "checklist_draft")).toContain(fake.checklist[0]?.id ?? "");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  await expect(page.getByText(techCopy.visit.task(2, 3), { exact: true })).toBeVisible();
  await stepAction(page).click();
  await expect(page.getByText(techCopy.visit.task(3, 3), { exact: true })).toBeVisible();

  // The last task lands the list, every item done.
  await footAction(page).click();
  await expect.poll(() => writesTo(fake, "checklist").length).toBe(1);
  expect(writesTo(fake, "checklist")[0]?.body).toEqual({ done: fake.checklist.map((item) => item.id) });
  await expect.poll(() => deviceRecordOnPhone(page, "checklist_draft")).toBeNull();
});

test("names the checklist for the visit it is on", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);

  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.replacement })).toBeVisible();
  await expect(page.getByText(techCopy.steps.titles.checklist)).toHaveCount(0);
});

test("says each count as it changes, and ties it to the buttons that change it", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist");
  await page.goto(`/jobs/${JOB_ID}/consumables`);

  const more = page.getByRole("button", { name: "One more tape strips" });
  await more.click();
  await expect(page.getByRole("status").filter({ hasText: "Tape strips: 5" })).toBeAttached();
  await expect(more).toHaveAccessibleDescription("Tape strips: 5");
});

// The consumables are ops', with what each service is expected to use (docs/decisions/0087-consumables-and-stock.md).
test.describe("the consumables step", () => {
  test("starts each stepper at what the visit’s service expects, and keeps the rest behind Add another", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    startedThrough(fake, "before_photos", "checklist");
    await page.goto(`/jobs/${JOB_ID}/consumables`);

    await expect(page.getByRole("status").filter({ hasText: "Tape strips: 4" })).toBeAttached();
    await expect(page.getByRole("status").filter({ hasText: "Solvent: 10" })).toBeAttached();
    await expect(page.getByText("4 strips expected")).toBeVisible();
    await expect(page.getByRole("button", { name: "One more bonding glue" })).toHaveCount(0);
    // Untouched, the step goes on in one tap to the step after.
    await expect(stepAction(page)).toHaveText(techCopy.visit.next("After photos"));

    const another = page.getByRole("button", { name: techCopy.steps.consumables.add });
    await expect(another).toHaveAttribute("aria-expanded", "false");
    await another.click();
    await expect(page.getByRole("button", { name: "Add Shampoo sachet" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Add Bonding glue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Bonding glue: 1" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Add Bonding glue" })).toHaveCount(0);
    await expect(stepAction(page)).toBeVisible();
  });

  // A count stepped below what the service expects closed the job at no cost, and nobody was told (ADR 0222).
  test("sends each consumable by its code, and says why one taken down to nought was not used", async ({ page }) => {
    const words = techCopy.steps.consumables;
    const fake = await fakeTech(page);
    startedThrough(fake, "before_photos", "checklist");
    await page.goto(`/jobs/${JOB_ID}/consumables`);
    await expect(page.getByRole("radiogroup", { name: words.whyShort })).toHaveCount(0);

    await page.getByRole("button", { name: "One more tape strips" }).click();
    for (let count = 0; count < 2; count += 1) await page.getByRole("button", { name: "5 ml less solvent" }).click();
    await page.getByRole("button", { name: words.add }).click();
    await page.getByRole("button", { name: "Add Shampoo sachet" }).click();

    // Short of the solvent expected: Next waits for why.
    await expect(page.getByText(words.pickWhy, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
    await page
      .getByRole("radiogroup", { name: words.whyShort })
      .getByRole("radio", { name: words.shortReasons.ran_out })
      .click();
    await stepAction(page).click();

    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.after_photos })).toBeVisible();
    await expect.poll(() => writesTo(fake, "consumables").length).toBe(1);
    expect(writesTo(fake, "consumables")[0]?.body).toEqual({
      items: [
        { code: "tape_strips", quantity: 5 },
        { code: "shampoo_sachet", quantity: 1 },
      ],
      short_reason: "ran_out",
    });
  });
});

test.describe("on a 360 × 640 phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("keeps a long checklist’s action at the foot and its head in view, scrolling only the list", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    fake.checklist = ONE_VISIT_CHECKLIST;
    fake.clientChoice = { product: "natural" };
    startedThrough(fake, "before_photos", "piece");
    await page.goto(`/jobs/${JOB_ID}/checklist`);

    const heading = page.getByRole("heading", { level: 1, name: techCopy.oneVisit.checklist });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(footAction(page)).toHaveText(techCopy.visit.nextTask);
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);

    // Reaching each item scrolls the list alone; the head and the foot stay where they are.
    await expect(page.getByText(techCopy.visit.task(1, 9))).toBeVisible();
    await throughTheTasks(page);

    await expect(footAction(page)).toHaveText(techCopy.visit.next("Consumables"));
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });

  test("keeps the hair profile’s action at the foot and its head in view, down to its last field", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "consultation";
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/profile`);

    const heading = page.getByRole("heading", { level: 1, name: techCopy.steps.titles.profile });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);

    const lastField = page.locator("main > div").first().locator(":scope > *").last();
    await lastField.scrollIntoViewIfNeeded();
    await expect(lastField).toBeInViewport();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("each step slides in on the house curve, and the capture screen stays still", async ({ page }) => {
    const fake = await fakeTech(page);
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/checklist`);
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const motion = await main.evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, duration: style.animationDuration, curve: style.animationTimingFunction };
    });
    expect(motion.name).not.toBe("none");
    expect(motion.duration).toBe("0.3s");
    expect(motion.curve).toBe("cubic-bezier(0.22, 0.61, 0.36, 1)");

    // "Nothing animates while capturing."
    await page.goto(`/jobs/${JOB_ID}/after-photos`);
    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.after_photos })).toBeVisible();
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });
});

test("a step the API refused can be corrected where it stands in the queue, not only thrown away", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  fake.kitHairSystems = holding("standard", "MM-STD-7193-C");
  startedThrough(fake, "before_photos", "checklist", "consumables");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // A label an older build let through, refused by the API, with the outcome queued behind it.
  await queuedOnPhone(page, [
    {
      id: "01000000-0000-7000-8000-00000000000a",
      kind: "piece",
      route: "piece",
      body: { piece_code: "MM-STD-7193 C", supplier_lot: "LOT-5120" },
      refused: { note: "invalid_request", fields: ["piece_code"] },
    },
    { id: "01000000-0000-7000-8000-00000000000b", kind: "outcome", route: "outcome", body: { outcome: "done" } },
  ]);

  await page.goto("/waiting");
  await expect(page.getByText("The hair system’s label wasn’t accepted.")).toBeVisible();
  await page.getByRole("button", { name: techCopy.queue.correct }).click();

  // The step opens as it was sent, so only the label is typed again.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.piece })).toBeVisible();
  await expect(page.getByText(techCopy.steps.corrected.piece)).toBeVisible();
  const label = page.getByRole("textbox", { name: techCopy.steps.piece.label });
  await expect(label).toHaveValue("MM-STD-7193 C");
  await expect(page.getByRole("textbox", { name: techCopy.steps.piece.lot })).toHaveValue("LOT-5120");
  await label.fill("MM-STD-7193-C");
  await stepAction(page).click();

  // The corrected piece goes first, and the outcome that waited behind it follows.
  await expect.poll(() => fake.writes.map((write) => write.path.split("/").at(-1))).toEqual(["piece", "outcome"]);
  expect(writesTo(fake, "piece").at(-1)?.body).toMatchObject({ piece_code: "MM-STD-7193-C", supplier_lot: "LOT-5120" });
  await page.goto("/waiting");
  await expect(page.getByText(techCopy.queue.nothing)).toBeVisible();
});

// A refused outcome opened with nothing chosen, and the technician chose it all again at the door.
test("a refused outcome opens as it was chosen", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await queuedOnPhone(page, [
    {
      id: "01000000-0000-7000-8000-00000000000c",
      kind: "outcome",
      route: "outcome",
      body: { outcome: "partial", reason: "client_stopped_it" },
      refused: { note: "invalid_request", fields: ["reason"] },
    },
  ]);

  await page.goto("/waiting");
  await expect(page.getByText("That reason wasn’t accepted.")).toBeVisible();
  await page.getByRole("button", { name: techCopy.queue.correct }).click();

  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.outcome })).toBeVisible();
  await expect(page.getByRole("radio", { name: techCopy.steps.outcome.partial, exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Client stopped it partway" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "More time needed" }).click();
  await stepAction(page).click();

  await expect
    .poll(() => writesTo(fake, "outcome").at(-1)?.body)
    .toEqual({ outcome: "partial", reason: "more_time_needed" });
});

// The kit went to -4 strips with no word on the step.
test("the consumables step says what the kit holds, and when more is counted than that", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist");
  await page.goto(`/jobs/${JOB_ID}/consumables`);
  await expect(page.getByText(techCopy.steps.consumables.inKit(5, "strip", false))).toBeVisible();
  await page.getByRole("button", { name: techCopy.steps.consumables.more("Tape strips", 1, "strip") }).click();
  await page.getByRole("button", { name: techCopy.steps.consumables.more("Tape strips", 1, "strip") }).click();
  await expect(page.getByText(techCopy.steps.consumables.inKit(5, "strip", true))).toBeVisible();
});

test("leaves a note for the next technician and an alert with the close, only when written", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  await page.getByLabel(techCopy.steps.outcome.nextNote).fill("  Edge lifting at the left temple. ");
  await page.getByLabel(techCopy.steps.outcome.alert).fill("Allergic to latex.");
  expect(await axeViolations(page)).toEqual([]);
  await stepAction(page).click();
  await expect
    .poll(() => writesTo(fake, "outcome").at(-1)?.body)
    .toEqual({ outcome: "done", handoff_note: "Edge lifting at the left temple.", client_alert: "Allergic to latex." });
  // Once sent, the phone keeps what was decided, and none of what was written about the client.
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
  const kept = await recordOnPhone(page, "closures", JOB_ID);
  expect(kept).toContain('"outcome":"done"');
  expect(kept).not.toContain("handoff_note");
  expect(kept).not.toContain("client_alert");
});

test("guides each task with its words, what to watch for, and the client's alerts under its name", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.alerts = [
    {
      id: "55555555-5555-4555-8555-555555555551",
      body: "Allergic to latex.",
      raised_by: { kind: "staff" },
      written_at: "2026-09-02T05:00:00.000Z",
    },
  ];
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);

  await expect(page.getByText(techCopy.visit.task(1, 3))).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Remove the hair system" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Spray solvent along the front edge." })).toBeVisible();
  await expect(page.getByText(techCopy.visit.watchFor)).toBeVisible();
  await expect(page.getByText("Allergic to latex.")).toBeVisible();
  await expect(stepAction(page)).toHaveText(techCopy.visit.nextTask);
  expect(await axeViolations(page)).toEqual([]);

  // On the last task, the action goes on to the step after.
  await throughTheTasks(page);
  await expect(page.getByText(techCopy.visit.task(3, 3))).toBeVisible();
  await expect(stepAction(page)).toHaveText(techCopy.visit.next("Consumables"));
});
