// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ONE_VISIT_CHECKLIST, ROHITS_PIECE, ROHITS_PROFILE } from "./fixtures.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { startedThrough, writesTo, checklistItems } from "./steps-fixtures.ts";

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
    const label = page.getByRole("textbox", { name: "The new piece’s label" });

    await label.fill("mm-std-7193 c");
    await expect(label).toHaveValue("MM-STD-7193-C");
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

    await label.fill("MM-STD-71");
    await expect(page.getByRole("button", { name: "Check the label to continue" })).toBeDisabled();
    await expect(
      page.getByText("Type it as the tag reads: MM, the base code, a number and a letter, as in MM-STD-4417-B."),
    ).toBeVisible();
  });

  test("says what a first fit was paid for, and warns when the hair profile names another product", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.service = { tier: "natural", name: "Mane Man Natural" };
    fake.profile = ROHITS_PROFILE;
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/piece`);

    await expect(page.getByRole("region", { name: "Paid for" })).toContainText("Mane Man Natural");
    await expect(
      page.getByRole("alert").filter({
        hasText: "The hair profile says Mane Man Essential. Check with ops before you fit.",
      }),
    ).toBeVisible();
  });

  test("the label field is the whole of its 64 px box, so a gloved tap lands in it", async ({ page }) => {
    await onThePiece(page);
    const box = await page.getByRole("textbox", { name: "The new piece’s label" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
  });

  test("with no signal says the label is not checked, rather than unknown", async ({ page }) => {
    const fake = await onThePiece(page);
    await page.getByRole("textbox", { name: "The new piece’s label" }).fill("MM-STD-7193-C");
    fake.online = false;
    await page.getByRole("button", { name: "Check the label" }).click();

    await expect(
      page.getByText("No signal, so the label isn’t checked. It goes on the job as you typed it."),
    ).toBeVisible();
    await expect(page.getByText(/We do not know that label/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test("will not record another client's piece", async ({ page }) => {
    await onThePiece(page);
    await page.getByRole("textbox", { name: "The new piece’s label" }).fill("MM-STD-9999-Z");
    await page.getByRole("button", { name: "Check the label" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "That piece isn’t this client’s." })).toBeVisible();
    await expect(page.getByRole("button", { name: "That piece isn’t this client’s" })).toBeDisabled();
    // The other piece's base and lot stay off this job.
    await expect(page.locator("#piece-base")).toHaveValue("");
    await expect(page.locator("#piece-lot")).toHaveValue("");
  });

  test("picks the piece from the client's list, and sends its base, its lot and the piece that came off", async ({
    page,
  }) => {
    const fake = await onThePiece(page);

    // The new piece: typed, with its base and lot, which the pieces tab reads.
    await page.getByRole("textbox", { name: "The new piece’s label" }).fill("MM-STD-5120-A");
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
    expect(await axeViolations(page)).toEqual([]);

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

// A consultation and fit in one visit, which no board draws: the client chooses the product with the technician at
// the piece step, straight after the before photographs, or decides against the fit
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
test.describe("the piece of a consultation and fit in one visit", () => {
  async function onTheChoice(page: Page): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    fake.checklist = ONE_VISIT_CHECKLIST;
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: "The piece" })).toBeVisible();
    return fake;
  }

  /** The one visit at its outcome, the client's choice landed with its piece step, and any code on the visit. */
  async function atTheOutcome(
    page: Page,
    choice: Fake["clientChoice"],
    discountCode: Fake["discountCode"] = null,
  ): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    fake.clientChoice = choice;
    fake.discountCode = discountCode;
    startedThrough(fake, "before_photos", "piece", "checklist", "consumables", "profile", "after_photos");
    await page.goto(`/jobs/${JOB_ID}/outcome`);
    return fake;
  }

  test("asks the client's choice first, by name, and sends the product with the piece fitted", async ({ page }) => {
    const fake = await onTheChoice(page);
    await expect(
      page.getByRole("button", { name: "Choose the hair system, or that the client decided against it" }),
    ).toBeDisabled();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Mane Man Natural" }).click();
    await expect(page.getByRole("button", { name: "Mane Man Natural" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "The new piece’s label" }).fill("MM-NAT-5120-A");
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ piece_code: "MM-NAT-5120-A", product: "natural" });
  });

  test("records that the client decided against it, and asks for no label", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("button", { name: "Decided against it", exact: true }).click();
    await expect(page.getByText("Nothing is fitted. The visit ends as a free consultation.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "The new piece’s label" })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ declined: true });
  });

  // The fit's items are never asked of a technician who fitted nothing.
  test("runs the consultation's checklist alone once the client decided against the fit", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("button", { name: "Decided against it", exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Consultation checklist" })).toBeVisible();
    const items = checklistItems(page);
    await expect(items).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Adhesive applied/ })).toHaveCount(0);
    for (const item of await items.all()) await item.click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => writesTo(fake, "checklist").length).toBe(1);
    expect(writesTo(fake, "checklist")[0]?.body).toEqual({
      done: ["scalp_checked", "measurements_taken", "options_shown"],
    });
  });

  test("runs the consultation's checklist and the fit's for a client being fitted", async ({ page }) => {
    await onTheChoice(page);
    await page.getByRole("button", { name: "Mane Man Natural" }).click();
    await page.getByRole("textbox", { name: "The new piece’s label" }).fill("MM-NAT-5120-A");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Consultation and fit checklist" })).toBeVisible();
    await expect(checklistItems(page)).toHaveCount(9);
  });

  // A declined visit offers no code and promises no link, and closes as what it became.
  test("ends a declined visit as a free consultation, with no code asked for, and closes as one", async ({ page }) => {
    const fake = await atTheOutcome(page, { declined: true }, { code: "AUDTEST", given_by: "client" });
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect(page.getByText("Ends as a free consultation. Nothing to pay.")).toBeVisible();
    await expect(page.getByText(/payment link/)).toHaveCount(0);
    await expect(page.getByText(/AUDTEST/)).toHaveCount(0);
    await expect(page.getByLabel("Discount code, if the client has one")).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Rohit M. · free consultation")).toBeVisible();
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done" });
  });

  test("names the product the payment link is for, once the client chose it", async ({ page }) => {
    await atTheOutcome(page, { product: "natural" });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Closing texts the client a payment link for Mane Man Natural.")).toBeVisible();
    await expect(page.getByLabel("Discount code, if the client has one")).toBeVisible();
  });

  // A discount code the client gives, before the link goes (docs/decisions/0108-discount-codes.md).
  test("takes a discount code before the link goes, asked at once, and says only that a wrong one does not apply", async ({
    page,
  }) => {
    const fake = await atTheOutcome(page, { product: "natural" });
    // Routed after the fake API, so this route answers the code ahead of it.
    const asked: unknown[] = [];
    await page.route(`**/api/tech/jobs/${JOB_ID}/discount-code`, (route) => {
      const body = route.request().postDataJSON() as { code: string };
      asked.push(body);
      if (body.code === "WEDDNG25") return route.fulfill({ json: { code: "WEDDNG25" } });
      return route.fulfill({ status: 422, json: { error: { code: "code_not_applicable", request_id: "test" } } });
    });
    const box = page.getByLabel("Discount code, if the client has one");
    await expect(box).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await box.fill("wrong1");
    await page.getByRole("button", { name: "Apply code" }).click();
    await expect(page.getByRole("alert")).toHaveText("That code doesn’t apply to this visit.");

    await box.fill("WEDDNG25");
    await page.getByRole("button", { name: "Apply code" }).click();
    await expect(page.getByText("Code WEDDNG25 applied. The payment link will take it off.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    expect(asked).toEqual([{ code: "wrong1" }, { code: "WEDDNG25" }]);
    // Asked straight, never queued in the outbox.
    expect(writesTo(fake, "discount-code")).toHaveLength(0);
  });

  test("says the code the client booked with, and asks for none", async ({ page }) => {
    await atTheOutcome(page, { product: "natural" }, { code: "AUDTEST", given_by: "client" });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Code AUDTEST applied at booking. The payment link will take it off.")).toBeVisible();
    await expect(page.getByLabel("Discount code, if the client has one")).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
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
