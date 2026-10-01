// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { atTheDoor, fakeTech, heldOnPhone, JOB_ID, ROHITS_PIECE, type Fake, type Step } from "./fixtures.ts";

const wcag = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A job checked in, started, and through the steps named. */
function startedThrough(fake: Fake, ...steps: Step[]): void {
  fake.progress = {
    ...fake.progress,
    checked_in_at: ago(30),
    wait_ends_at: ago(15),
    distance_m: 40,
    started_at: ago(25),
    steps_done: steps,
  };
}

const writesTo = (fake: Fake, step: string) => fake.writes.filter((write) => write.path.endsWith(`/${step}`));

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
  for (const item of await page.getByRole("button", { name: /PLACEHOLDER/ }).all()) await item.click();

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

/** The words of every element drawn in gold: in its type, its ground or its edge. */
const gilded = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const drawn = [style.color, style.backgroundColor, style.borderLeftColor, style.fill, style.stroke];
        return drawn.includes("rgb(201, 163, 99)");
      })
      .map((element) => element.textContent.trim()),
  );

// Ruling 59 (ADR 0025), 27 September 2026: "gold marks only the one primary action". The boards also gild a ticked
// box, a step's count and a chosen outcome or reason.
test("draws nothing in gold but the one primary action", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  const items = page.getByRole("button", { name: /PLACEHOLDER/ });
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) await item.click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  expect(await gilded(page)).toEqual(["Next"]);
  expect((await wcag(page)).violations.map((violation) => violation.id)).toEqual([]);

  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("button", { name: "Partial · pick a reason" }).click();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  expect(await gilded(page)).toEqual(["Next"]);
  expect((await wcag(page)).violations.map((violation) => violation.id)).toEqual([]);
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
    const results = await wcag(page);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

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
  const first = page.getByRole("button", { name: /PLACEHOLDER Piece removed/ });
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

test.describe("the piece (board B3, step 4)", () => {
  async function onThePiece(page: Page): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "replacement";
    fake.pieces = [ROHITS_PIECE];
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: "The piece" })).toBeVisible();
    return fake;
  }

  test("reads a label typed with a space as the hyphen it means, and keeps a malformed one from Next", async ({
    page,
  }) => {
    await onThePiece(page);
    const label = page.getByRole("textbox", { name: "The new piece's label" });

    await label.fill("mm-std-7193 c");
    await expect(label).toHaveValue("MM-STD-7193-C");
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

    await label.fill("MM-STD-71");
    await expect(page.getByRole("button", { name: "Check the label to continue" })).toBeDisabled();
    await expect(page.getByText("A label reads MM, the base, the number and a letter: MM-STD-4417-B.")).toBeVisible();
  });

  test("the label field is the whole of its 64 px box, so a gloved tap lands in it", async ({ page }) => {
    await onThePiece(page);
    const box = await page.getByRole("textbox", { name: "The new piece's label" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
  });

  test("with no signal says the label is not checked, rather than unknown", async ({ page }) => {
    const fake = await onThePiece(page);
    await page.getByRole("textbox", { name: "The new piece's label" }).fill("MM-STD-7193-C");
    fake.online = false;
    await page.getByRole("button", { name: "Check the label" }).click();

    await expect(
      page.getByText("No signal, so the label is not checked. It goes on the job as you typed it."),
    ).toBeVisible();
    await expect(page.getByText(/We do not know that label/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test("will not record another client's piece", async ({ page }) => {
    await onThePiece(page);
    await page.getByRole("textbox", { name: "The new piece's label" }).fill("MM-STD-9999-Z");
    await page.getByRole("button", { name: "Check the label" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "That piece is not this client's." })).toBeVisible();
    await expect(page.getByRole("button", { name: "That piece is not this client's" })).toBeDisabled();
  });

  test("picks the piece from the client's list, and sends its base, its lot and the piece that came off", async ({
    page,
  }) => {
    const fake = await onThePiece(page);

    // The new piece: typed, with its base and lot, which the pieces tab reads.
    await page.getByRole("textbox", { name: "The new piece's label" }).fill("MM-STD-5120-A");
    await page.getByRole("textbox", { name: "Base" }).fill("PLACEHOLDER_STANDARD");
    await page.getByRole("textbox", { name: "Supplier lot" }).fill("LOT-5120");

    // The one that came off, picked from the client's pieces rather than typed.
    await page.getByRole("button", { name: "Pick from the list" }).click();
    await page.getByRole("button", { name: /MM-STD-4417-B/ }).click();
    await expect(page.getByRole("textbox", { name: "The label of the piece that came off" })).toHaveValue(
      "MM-STD-4417-B",
    );
    await expect(page.getByRole("button", { name: "Say why it failed to continue" })).toBeDisabled();
    await page.getByRole("textbox", { name: "Why it failed" }).fill("Lifted at the front");
    const results = await wcag(page);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-STD-5120-A",
      base: "PLACEHOLDER_STANDARD",
      supplier_lot: "LOT-5120",
      old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Lifted at the front" },
    });
  });
});

test("a step the API refused can be corrected where it stands in the queue, not only thrown away", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  startedThrough(fake, "before_photos", "checklist", "consumables");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // A label an older build let through, refused by the API, with the after set and the outcome queued behind it.
  await page.evaluate(async (job) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    const event = (id: string, kind: string, route: string, body: unknown, state: string) => ({
      id,
      job_id: job,
      kind,
      path: `/tech/jobs/${job}/${route}`,
      body,
      queued_at: Date.now(),
      state,
      note: state === "refused" ? "invalid_request" : null,
      fields: state === "refused" ? ["piece_code"] : [],
    });
    await new Promise<void>((resolve) => {
      const transaction = db.transaction("outbox", "readwrite");
      const outbox = transaction.objectStore("outbox");
      outbox.add(
        event("01000000-0000-7000-8000-00000000000a", "piece", "piece", { piece_code: "MM-STD-7193 C" }, "refused"),
      );
      outbox.add(event("01000000-0000-7000-8000-00000000000b", "outcome", "outcome", { outcome: "done" }, "waiting"));
      transaction.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  }, JOB_ID);

  await page.goto("/waiting");
  await expect(page.getByText("The piece's label was not accepted.")).toBeVisible();
  await page.getByRole("button", { name: "Correct it" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "The piece" })).toBeVisible();
  await expect(page.getByText("We could not record the label you gave. Correct it and tap Next.")).toBeVisible();
  await page.getByRole("textbox", { name: "The new piece's label" }).fill("MM-STD-7193-C");
  await page.getByRole("button", { name: "Next" }).click();

  // The corrected piece goes first, and the outcome that waited behind it follows.
  await expect.poll(() => fake.writes.map((write) => write.path.split("/").at(-1))).toEqual(["piece", "outcome"]);
  await page.goto("/waiting");
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
});

// A consultation and fit in one visit, which no board draws: the client chooses the product with the technician at
// the piece step, or decides against the fit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
test.describe("the piece of a consultation and fit in one visit", () => {
  async function onTheChoice(page: Page): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: "The piece" })).toBeVisible();
    return fake;
  }

  test("asks the client's choice first, by name, and sends the product with the piece fitted", async ({ page }) => {
    const fake = await onTheChoice(page);
    await expect(
      page.getByRole("button", { name: "Choose the product, or that the client decided against it" }),
    ).toBeDisabled();
    expect((await wcag(page)).violations).toEqual([]);

    await page.getByRole("button", { name: "Mane Man Natural" }).click();
    await expect(page.getByRole("button", { name: "Mane Man Natural" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "The new piece's label" }).fill("MM-NAT-5120-A");
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ piece_code: "MM-NAT-5120-A", product: "natural" });
  });

  test("records that the client decided against it, and asks for no label", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("button", { name: "Decided against it", exact: true }).click();
    await expect(
      page.getByText("Nothing is fitted. Closing as done ends the visit as a consultation, with nothing to pay."),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "The new piece's label" })).toHaveCount(0);
    expect((await wcag(page)).violations).toEqual([]);
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ declined: true });
  });

  // A discount code the client gives, before the link goes (docs/decisions/0108-discount-codes.md).
  test("takes a discount code before the link goes, asked at once, and says only that a wrong one does not apply", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    startedThrough(fake, "before_photos", "checklist", "consumables", "piece", "after_photos");
    const asked: unknown[] = [];
    await page.route(`**/api/tech/jobs/${JOB_ID}/discount-code`, (route) => {
      const body = route.request().postDataJSON() as { code: string };
      asked.push(body);
      if (body.code === "WEDDNG25") return route.fulfill({ json: { code: "WEDDNG25" } });
      return route.fulfill({ status: 422, json: { error: { code: "code_not_applicable", request_id: "test" } } });
    });
    await page.goto(`/jobs/${JOB_ID}/outcome`);
    const box = page.getByLabel("Discount code, if the client has one");
    await expect(box).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await box.fill("wrong1");
    await page.getByRole("button", { name: "Apply code" }).click();
    await expect(page.getByRole("alert")).toHaveText("That code does not apply to this visit.");

    await box.fill("WEDDNG25");
    await page.getByRole("button", { name: "Apply code" }).click();
    await expect(page.getByText("Code WEDDNG25 applied. The payment link will take it off.")).toBeVisible();
    expect((await wcag(page)).violations).toEqual([]);
    expect(asked).toEqual([{ code: "wrong1" }, { code: "WEDDNG25" }]);
    // Asked straight, never queued in the outbox.
    expect(writesTo(fake, "discount-code")).toHaveLength(0);
  });

  test("names the job a consultation and fit, paid for once fitted", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    await page.goto(`/jobs/${JOB_ID}`);
    await expect(page.getByText(/consultation and fit/)).toBeVisible();
    await expect(page.getByText("Pays once fitted")).toBeVisible();
  });
});
