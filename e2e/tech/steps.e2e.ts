// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  atTheDoor,
  fakeTech,
  heldOnPhone,
  JOB_ID,
  ONE_VISIT_CHECKLIST,
  pageScrolls,
  queuedOnPhone,
} from "./fixtures.ts";
import { startedThrough, writesTo, checklistItems, gilded } from "./steps-fixtures.ts";

/** A step's one action, in the foot below its body. */
const footAction = (page: Page) => page.locator("main > div").last().getByRole("button");

test("a double tap on Start job starts the job once", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();

  await page.getByRole("button", { name: "Start job" }).dblclick();
  await expect(page.getByRole("heading", { level: 1, name: "Before photos" })).toBeVisible();
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

  await page.getByRole("button", { name: "I have arrived" }).click();
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page).toHaveTitle("Before photos · Mane Man technician");
  await expect(page.getByRole("heading", { level: 1, name: "Before photos" })).toBeFocused();
});

test("a double tap on Next finishes one step, and never the step it opens", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
  for (const item of await checklistItems(page).all()) await item.click();

  await page.getByRole("button", { name: "Next" }).dblclick();

  await expect(page.getByRole("heading", { level: 1, name: "Consumables used" })).toBeVisible();
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
  expect(writesTo(fake, "checklist")).toHaveLength(1);
  // The consumables' Next sits where the checklist's was, and the second tap did not reach it.
  expect(writesTo(fake, "consumables")).toHaveLength(0);
});

test("the outcome has nothing chosen for the technician, and Next waits for his choice", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);

  const done = page.getByRole("button", { name: "Done", exact: true });
  await expect(done).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Choose Done or Partial" })).toBeDisabled();

  await done.click();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  // The choice is outlined, and the one gold thing is still Next.
  expect(await done.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgb(201, 163, 99)");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Rohit M. · done")).toBeVisible();
  expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done" });
});

// ADR 0025, item 59: "gold marks only the one primary action". The boards also gild a ticked
// box, a step's count and a chosen outcome or reason.
test("draws nothing in gold but the one primary action", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  const items = checklistItems(page);
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) await item.click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  expect(await gilded(page)).toEqual(["Next"]);
  expect(await axeViolations(page)).toEqual([]);

  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("button", { name: "Partial · pick a reason" }).click();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  expect(await gilded(page)).toEqual(["Next"]);
  expect(await axeViolations(page)).toEqual([]);
});

test("names the checklist for the visit it is on", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);

  await expect(page.getByRole("heading", { level: 1, name: "Replacement checklist" })).toBeVisible();
  await expect(page.getByText("Service checklist")).toHaveCount(0);
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
  test("starts each stepper at what the visit's service expects, and keeps the rest behind Add another", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    startedThrough(fake, "before_photos", "checklist");
    await page.goto(`/jobs/${JOB_ID}/consumables`);

    await expect(page.getByRole("status").filter({ hasText: "Tape strips: 4" })).toBeAttached();
    await expect(page.getByRole("status").filter({ hasText: "Solvent: 10" })).toBeAttached();
    await expect(page.getByText("strip · 4 expected")).toBeVisible();
    await expect(page.getByRole("button", { name: "One more bonding glue" })).toHaveCount(0);

    const another = page.getByRole("button", { name: "Add another" });
    await expect(another).toHaveAttribute("aria-expanded", "false");
    await another.click();
    await expect(page.getByRole("button", { name: "Add Shampoo sachet" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Add Bonding glue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Bonding glue: 1" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Add Bonding glue" })).toHaveCount(0);
  });

  test("sends each consumable by its code, and one taken down to nought not at all", async ({ page }) => {
    const fake = await fakeTech(page);
    startedThrough(fake, "before_photos", "checklist");
    await page.goto(`/jobs/${JOB_ID}/consumables`);

    await page.getByRole("button", { name: "One more tape strips" }).click();
    for (let count = 0; count < 10; count += 1) await page.getByRole("button", { name: "One fewer solvent" }).click();
    await page.getByRole("button", { name: "Add another" }).click();
    await page.getByRole("button", { name: "Add Shampoo sachet" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
    await expect.poll(() => writesTo(fake, "consumables").length).toBe(1);
    expect(writesTo(fake, "consumables")[0]?.body).toEqual({
      items: [
        { code: "tape_strips", quantity: 5 },
        { code: "shampoo_sachet", quantity: 1 },
      ],
    });
  });
});

test("a focused checklist line shows its whole focus ring, not one cut by the screen's edge", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  const first = page.getByRole("button", { name: /Hair system removed/ });
  await expect(first).toBeVisible();

  await first.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();

  const clipped = await first.evaluate((element) => {
    const style = getComputedStyle(element);
    const reach = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const ring = element.getBoundingClientRect();
    const outer = { left: ring.left - reach, right: ring.right + reach, top: ring.top - reach };
    if (outer.left < 0 || outer.right > window.innerWidth) return "the screen's edge";
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (overflow === "visible") continue;
      const box = parent.getBoundingClientRect();
      if (outer.left < box.left || outer.right > box.right || outer.top < box.top) return parent.className;
    }
    return null;
  });
  expect(clipped).toBeNull();
});

test.describe("on a 360 × 640 phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("keeps a long checklist's action at the foot and its head in view, scrolling only the list", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    fake.checklist = ONE_VISIT_CHECKLIST;
    fake.clientChoice = { product: "natural" };
    startedThrough(fake, "before_photos", "piece");
    await page.goto(`/jobs/${JOB_ID}/checklist`);

    const heading = page.getByRole("heading", { level: 1, name: "Consultation and fit checklist" });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(footAction(page)).toHaveText("Finish the list to continue");
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);

    // Reaching each item scrolls the list alone; the head and the foot stay where they are.
    const items = checklistItems(page);
    await expect(items).toHaveCount(9);
    for (const item of await items.all()) await item.click();

    await expect(footAction(page)).toHaveText("Next");
    await expect(footAction(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });

  test("keeps the hair profile's action at the foot and its head in view, down to its last field", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "consultation";
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/profile`);

    const heading = page.getByRole("heading", { level: 1, name: "Hair profile" });
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
    await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });
});

test("a step the API refused can be corrected where it stands in the queue, not only thrown away", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
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
  await expect(page.getByText("The piece’s label wasn’t accepted.")).toBeVisible();
  await page.getByRole("button", { name: "Correct it" }).click();

  // The step opens as it was sent, so only the label is typed again.
  await expect(page.getByRole("heading", { level: 1, name: "The piece" })).toBeVisible();
  await expect(page.getByText("We couldn’t record the label you gave. Correct it and tap Next.")).toBeVisible();
  const label = page.getByRole("textbox", { name: "The new piece’s label" });
  await expect(label).toHaveValue("MM-STD-7193 C");
  await expect(page.getByRole("textbox", { name: "Supplier lot" })).toHaveValue("LOT-5120");
  await label.fill("MM-STD-7193-C");
  await page.getByRole("button", { name: "Next" }).click();

  // The corrected piece goes first, and the outcome that waited behind it follows.
  await expect.poll(() => fake.writes.map((write) => write.path.split("/").at(-1))).toEqual(["piece", "outcome"]);
  expect(writesTo(fake, "piece").at(-1)?.body).toMatchObject({ piece_code: "MM-STD-7193-C", supplier_lot: "LOT-5120" });
  await page.goto("/waiting");
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
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
  await page.getByRole("button", { name: "Correct it" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Outcome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Partial · pick a reason" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Client stopped it partway" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "More time needed" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect
    .poll(() => writesTo(fake, "outcome").at(-1)?.body)
    .toEqual({ outcome: "partial", reason: "more_time_needed" });
});
