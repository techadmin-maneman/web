// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ONE_VISIT_CHECKLIST, ROHITS_PIECE, ROHITS_PROFILE } from "./fixtures.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { holding, startedThrough, writesTo, checklistItems } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

test.describe("the piece (board B3, step 4)", () => {
  async function onThePiece(page: Page): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "replacement";
    fake.pieces = [ROHITS_PIECE];
    fake.kitHairSystems = holding("standard", "MM-STD-5120-A");
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.piece })).toBeVisible();
    return fake;
  }

  test("reads a label typed with a space as the hyphen it means, and keeps a malformed one from Next", async ({
    page,
  }) => {
    await onThePiece(page);
    const label = page.getByRole("textbox", { name: techCopy.steps.piece.label });

    await label.fill("mm-std-7193 c");
    await expect(label).toHaveValue("MM-STD-7193-C");
    // Not in the kit, so it is checked before the fit goes on.
    await expect(page.getByRole("button", { name: techCopy.steps.piece.uncheckedAction })).toBeDisabled();

    await label.fill("MM-STD-71");
    await expect(page.getByRole("button", { name: techCopy.steps.piece.checkFirst })).toBeDisabled();
    await expect(page.getByText(techCopy.steps.piece.malformed)).toBeVisible();
  });

  test("closes as partly done with no piece fitted, Can’t fit today, once asked", async ({ page }) => {
    const fake = await onThePiece(page);
    const words = techCopy.steps.piece.cannotFit;
    await page.getByRole("button", { name: words.action }).click();
    const asked = page.getByRole("dialog", { name: words.title });
    await expect(asked).toContainText(words.body);
    expect(await axeViolations(page)).toEqual([]);
    await asked.getByRole("button", { name: words.no }).click();
    await expect(asked).toHaveCount(0);
    expect(writesTo(fake, "outcome")).toEqual([]);

    await page.getByRole("button", { name: words.action }).click();
    await page.getByRole("dialog", { name: words.title }).getByRole("button", { name: words.yes }).click();
    await expect(page.getByText("Rohit M. · partly done")).toBeVisible();
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({
      outcome: "partial",
      reason: "no_piece",
      cannot_fit: true,
    });
  });

  test("says what a first fit was paid for, and warns when the hair profile names another product", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.service = { tier: "natural", name: "Mane Man Natural" };
    fake.profile = ROHITS_PROFILE;
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);

    await expect(page.getByRole("region", { name: techCopy.job.piece.rows.paidFor })).toContainText("Mane Man Natural");
    await expect(
      page.getByRole("alert").filter({
        hasText: "The hair profile says Mane Man Essential. Check with ops before you fit.",
      }),
    ).toBeVisible();
  });

  test("lists the kit’s hair systems, the one made to the profile first, and sends the one picked", async ({
    page,
  }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.service = { tier: "essential", name: "Mane Man Essential" };
    fake.profile = ROHITS_PROFILE;
    const spec = { product: "essential", base_width_in: 8, base_length_in: 10, colour: "1B", grey_percent: 20 };
    fake.kitHairSystems = [
      {
        ...spec,
        code: "hs_lighter",
        name: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density",
        held: 1,
        density_percent: 100,
        units: [],
      },
      {
        ...spec,
        code: "hs_exact",
        name: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density",
        held: 2,
        density_percent: 120,
        units: [],
      },
    ];
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);

    const kit = page.getByRole("region", { name: techCopy.steps.piece.kit.title });
    const choices = kit.getByRole("button");
    await expect(choices.first()).toContainText(`120% density · 2 in kit · ${techCopy.steps.piece.kit.matches}`);
    await choices.first().click();
    await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-STD-5120-A");
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ piece_code: "MM-STD-5120-A", stock_code: "hs_exact" });
  });

  test("a label from the kit picks its hair system and lot, and an expired one keeps Next dim", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.service = { tier: "essential", name: "Mane Man Essential" };
    fake.profile = ROHITS_PROFILE;
    fake.kitHairSystems = [
      {
        product: "essential",
        base_width_in: 8,
        base_length_in: 10,
        colour: "1B",
        grey_percent: 20,
        density_percent: 120,
        code: "hs_exact",
        name: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density",
        held: 2,
        units: [
          { code: "MM-ESS-0000007-H", lot_code: "HS-1", expires_on: "2031-03-31" },
          { code: "MM-ESS-0000008-J", lot_code: "OLD", expires_on: "2020-01-31" },
        ],
      },
    ];
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    const label = page.getByRole("textbox", { name: techCopy.steps.piece.label });

    await label.fill("MM-ESS-0000008-J");
    await expect(page.getByRole("alert")).toHaveText(techCopy.steps.piece.expired);
    await expect(page.getByRole("button", { name: techCopy.steps.piece.expiredAction })).toBeDisabled();

    await label.fill("mm-ess-0000007-h");
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.lot })).toHaveValue("HS-1");
    const kit = page.getByRole("region", { name: techCopy.steps.piece.kit.title });
    await expect(kit.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: techCopy.steps.next }).click();
    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-ESS-0000007-H",
      supplier_lot: "HS-1",
      stock_code: "hs_exact",
    });
  });

  test("says so when no camera opens to scan the label, which can still be typed", async ({ page }) => {
    await onThePiece(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: () => Promise.reject(new Error("No camera")) },
      });
    });
    await page.getByRole("button", { name: techCopy.steps.piece.scan }).click();
    await expect(page.getByRole("alert")).toHaveText(techCopy.steps.piece.camera.refused);
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.label })).toBeEditable();
  });

  test("the label field is the whole of its 64 px box, so a gloved tap lands in it", async ({ page }) => {
    await onThePiece(page);
    const box = await page.getByRole("textbox", { name: techCopy.steps.piece.label }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
  });

  test("with no signal says the label is not checked, rather than unknown", async ({ page }) => {
    const fake = await onThePiece(page);
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-STD-7193-C");
    fake.online = false;
    await page.getByRole("button", { name: techCopy.steps.piece.look }).click();

    await expect(page.getByText(techCopy.steps.piece.offline)).toBeVisible();
    await expect(page.getByText(/We do not know that label/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: techCopy.steps.next })).toBeEnabled();
  });

  test("will not record another client’s piece", async ({ page }) => {
    await onThePiece(page);
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-STD-9999-Z");
    await page.getByRole("button", { name: techCopy.steps.piece.look }).click();

    await expect(page.getByRole("alert").filter({ hasText: techCopy.steps.piece.notThisClient })).toBeVisible();
    await expect(page.getByRole("button", { name: techCopy.steps.piece.notThisClientAction })).toBeDisabled();
    // The other piece's base and lot stay off this job.
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.base, exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.lot, exact: true })).toHaveValue("");
  });

  test("picks the piece from the client’s list, and sends its base, its lot and the piece that came off", async ({
    page,
  }) => {
    const fake = await onThePiece(page);

    // The new piece: typed, with its base and lot, which the pieces tab reads.
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-STD-5120-A");
    await page.getByRole("textbox", { name: techCopy.steps.piece.base }).fill("PLACEHOLDER_STANDARD");
    await page.getByRole("textbox", { name: techCopy.steps.piece.lot }).fill("LOT-5120");

    // The one that came off, picked from the client's pieces rather than typed.
    await page.getByRole("button", { name: techCopy.steps.piece.pick }).click();
    await page.getByRole("button", { name: /MM-STD-4417-B/ }).click();
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.old.label })).toHaveValue("MM-STD-4417-B");
    await page.getByRole("textbox", { name: techCopy.steps.piece.old.reason }).fill("Lifted at the front");
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: techCopy.steps.next }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.replacement }),
    ).toBeVisible();
    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-STD-5120-A",
      base: "PLACEHOLDER_STANDARD",
      supplier_lot: "LOT-5120",
      stock_code: "hs_standard",
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
    fake.kitHairSystems = holding("natural", "MM-NAT-5120-A");
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.piece })).toBeVisible();
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

  test("asks the client’s choice first, by name, and sends the product with the piece fitted", async ({ page }) => {
    const fake = await onTheChoice(page);
    await expect(page.getByRole("button", { name: techCopy.oneVisit.chooseFirst })).toBeDisabled();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Mane Man Natural" }).click();
    await expect(page.getByRole("button", { name: "Mane Man Natural" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-NAT-5120-A");
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-NAT-5120-A",
      product: "natural",
      stock_code: "hs_natural",
    });
  });

  test("records that the client decided against it, and asks for no label", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("button", { name: techCopy.oneVisit.declined, exact: true }).click();
    await expect(page.getByText(techCopy.oneVisit.declinedNote)).toBeVisible();
    await expect(page.getByRole("textbox", { name: techCopy.steps.piece.label })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ declined: true });
  });

  // The fit's items are never asked of a technician who fitted nothing.
  test("runs the consultation’s checklist alone once the client decided against the fit", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("button", { name: techCopy.oneVisit.declined, exact: true }).click();
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.consultation }),
    ).toBeVisible();
    const items = checklistItems(page);
    await expect(items).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Adhesive applied/ })).toHaveCount(0);
    for (const item of await items.all()) await item.click();
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect.poll(() => writesTo(fake, "checklist").length).toBe(1);
    expect(writesTo(fake, "checklist")[0]?.body).toEqual({
      done: ["scalp_checked", "measurements_taken", "options_shown"],
    });
  });

  test("runs the consultation’s checklist and the fit’s for a client being fitted", async ({ page }) => {
    await onTheChoice(page);
    await page.getByRole("button", { name: "Mane Man Natural" }).click();
    await page.getByRole("textbox", { name: techCopy.steps.piece.label }).fill("MM-NAT-5120-A");
    await page.getByRole("button", { name: techCopy.steps.next }).click();

    await expect(page.getByRole("heading", { level: 1, name: techCopy.oneVisit.checklist })).toBeVisible();
    await expect(checklistItems(page)).toHaveCount(9);
  });

  // A declined visit offers no code and promises no link, and closes as what it became.
  test("ends a declined visit as a free consultation, with no code asked for, and closes as one", async ({ page }) => {
    const fake = await atTheOutcome(page, { declined: true }, { code: "AUDTEST", given_by: "client" });
    await page.getByRole("button", { name: techCopy.steps.outcome.done, exact: true }).click();

    await expect(page.getByText(techCopy.oneVisit.endsAsConsultation)).toBeVisible();
    await expect(page.getByText(/payment link/)).toHaveCount(0);
    await expect(page.getByText(/AUDTEST/)).toHaveCount(0);
    await expect(page.getByLabel(techCopy.oneVisit.code.label)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: techCopy.steps.next }).click();
    await expect(page.getByText("Rohit M. · free consultation")).toBeVisible();
    // Declined, the client is not going ahead with the fit, and the close says so.
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", going_ahead: false });
  });

  test("names the product the payment link is for, once the client chose it", async ({ page }) => {
    await atTheOutcome(page, { product: "natural" });
    await page.getByRole("button", { name: techCopy.steps.outcome.done, exact: true }).click();
    await expect(page.getByText("Closing sends the client a payment link for Mane Man Natural.")).toBeVisible();
    await expect(page.getByLabel(techCopy.oneVisit.code.label)).toBeVisible();
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
    const box = page.getByLabel(techCopy.oneVisit.code.label);
    await expect(box).toHaveCount(0);
    await page.getByRole("button", { name: techCopy.steps.outcome.done, exact: true }).click();
    await box.fill("wrong1");
    await page.getByRole("button", { name: techCopy.oneVisit.code.apply }).click();
    await expect(page.getByRole("alert")).toHaveText("That code doesn’t apply to this visit.");

    await box.fill("WEDDNG25");
    await page.getByRole("button", { name: techCopy.oneVisit.code.apply }).click();
    await expect(page.getByText("Code WEDDNG25 applied. The payment link will take it off.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    expect(asked).toEqual([{ code: "wrong1" }, { code: "WEDDNG25" }]);
    // Asked straight, never queued in the outbox.
    expect(writesTo(fake, "discount-code")).toHaveLength(0);
  });

  test("says the code the client booked with, and asks for none", async ({ page }) => {
    await atTheOutcome(page, { product: "natural" }, { code: "AUDTEST", given_by: "client" });
    await page.getByRole("button", { name: techCopy.steps.outcome.done, exact: true }).click();
    await expect(page.getByText("Code AUDTEST applied at booking. The payment link will take it off.")).toBeVisible();
    await expect(page.getByLabel(techCopy.oneVisit.code.label)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("names the job a consultation and fit, paid for once fitted", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    await page.goto(`/jobs/${JOB_ID}`);
    await expect(page.getByText(/consultation and fit/)).toBeVisible();
    await expect(page.getByText(techCopy.badges.at_visit)).toBeVisible();
  });
});
