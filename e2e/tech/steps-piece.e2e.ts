// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ONE_VISIT_CHECKLIST, ROHITS_PIECE, ROHITS_PROFILE, todayInIndia } from "./fixtures.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { holding, startedThrough, writesTo, throughTheTasks } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { stepAction } from "./steps-fixtures.ts";

/** "Type the code", and the code typed in. */
async function typeCode(page: Page, code: string): Promise<void> {
  const box = page.getByRole("textbox", { name: techCopy.steps.piece.typedLabel });
  if (!(await box.isVisible())) await page.getByRole("button", { name: techCopy.steps.piece.typeCode }).click();
  await box.fill(code);
}

/** Rohit's piece, worn since before the visit's day, as the one a replacement takes off. */
const WORN = { ...ROHITS_PIECE, fitted_at: "2020-07-02" };

// Scan-first, as the prototype draws it (docs/decisions/0270-the-design-checks-api-side.md).
test.describe("the hair system step", () => {
  async function onThePiece(page: Page): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "replacement";
    fake.pieces = [WORN];
    fake.kitHairSystems = holding("standard", "MM-STD-5120-A");
    startedThrough(fake, "before_photos");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.piece })).toBeVisible();
    return fake;
  }

  test("says what is expected and the piece it replaces, reads a typed space as a hyphen, and holds a malformed label", async ({
    page,
  }) => {
    await onThePiece(page);
    await expect(page.getByRole("heading", { level: 2, name: techCopy.steps.piece.scanTitle })).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.listed("MM-STD-4417-B", "2 Jul"))).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.pointAt)).toBeVisible();

    await typeCode(page, "mm-std-7193 c");
    const typed = page.getByRole("textbox", { name: techCopy.steps.piece.typedLabel });
    await expect(typed).toHaveValue("MM-STD-7193-C");
    // Checked as it reads, with no step of its own: not in the kit, so the fit does not go on.
    await expect(page.getByText(techCopy.steps.piece.notInKitAction, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();

    await typed.fill("MM-STD-71");
    await expect(page.getByText(techCopy.steps.piece.checkFirst, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
    await expect(page.getByText(techCopy.steps.piece.malformed)).toBeVisible();
  });

  test("Can’t fit today asks why from ops’ list, and closes the fit as not fitted with it", async ({ page }) => {
    const fake = await onThePiece(page);
    const words = techCopy.steps.piece.cannotFit;
    await page.getByRole("button", { name: words.action }).click();
    const asked = page.getByRole("dialog", { name: words.title });
    await expect(asked).toContainText(words.body);
    const close = asked.getByRole("button", { name: words.close });
    // Off until a reason is picked, saying so.
    await expect(close).toBeDisabled();
    await expect(asked.getByText(words.pickFirst, { exact: true })).toBeVisible();
    // The sheet's Close sits on the dialog's backdrop, which axe cannot see, as the reschedule sheet's does.
    expect(await axeViolations(page, (axe) => axe.exclude("dialog > button"))).toEqual([]);
    await asked.getByRole("button", { name: words.dismiss, exact: true }).click();
    await expect(asked).toHaveCount(0);
    expect(writesTo(fake, "outcome")).toEqual([]);

    await page.getByRole("button", { name: words.action }).click();
    await asked.getByRole("button", { name: "Piece damaged" }).click();
    await expect(asked.getByText(words.pickFirst, { exact: true })).toHaveCount(0);
    await close.click();
    await expect(page.getByRole("heading", { level: 1, name: techCopy.closeOut.titles.not_fitted })).toBeVisible();
    // The close names why, and what follows, as the prototype lists it.
    await expect(page.getByText(techCopy.closeOut.notFittedWhy("Piece damaged"), { exact: true })).toBeVisible();
    await expect(page.getByText(techCopy.closeOut.opsRebook, { exact: true })).toBeVisible();
    await expect(page.getByText(techCopy.closeOut.duration, { exact: true })).toHaveCount(0);
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({
      outcome: "partial",
      reason: "no_piece",
      cannot_fit: true,
      not_fitted_reason: "piece_damaged",
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

    await expect(page.getByText(techCopy.job.piece.rows.paidFor, { exact: true })).toBeVisible();
    await expect(page.getByText("Mane Man Natural", { exact: true })).toBeVisible();
    await expect(page.getByText("8 × 10 in · #1B · 20% grey · 120% density", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText: "The hair profile says Mane Man Essential. Check with ops before you fit.",
      }),
    ).toBeVisible();
  });

  test("picks kit stock whose pieces carry no labels from the kit, the one made to the profile first", async ({
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
    await expect(choices.first()).toContainText(`${techCopy.steps.piece.kit.matches} · `);
    await expect(choices.first()).toContainText("120% density · 2 in kit");
    await choices.first().click();
    await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
    await typeCode(page, "MM-STD-5120-A");
    await expect(page.getByText(techCopy.steps.piece.confirmed.left(1))).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await stepAction(page).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-STD-5120-A",
      base: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density",
      stock_code: "hs_exact",
    });
  });

  test("confirms a label from the kit against the profile and the kit, and holds an expired one", async ({ page }) => {
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

    await typeCode(page, "MM-ESS-0000008-J");
    await expect(page.getByRole("alert").filter({ hasText: techCopy.steps.piece.expired })).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.expiredAction, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();

    await typeCode(page, "mm-ess-0000007-h");
    const read = page.getByRole("region", { name: "MM-ESS-0000007-H" });
    // Named as the kit's hair system it is, not as the one expected.
    await expect(read).toContainText("Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density");
    await expect(read).toContainText(techCopy.steps.piece.confirmed.match);
    await expect(read).toContainText(techCopy.steps.piece.confirmed.left(1));
    expect(await axeViolations(page)).toEqual([]);
    await stepAction(page).click();
    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    // The label checked as it read: the kit's hair system names its base, and the kit's piece its lot.
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-ESS-0000007-H",
      base: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density",
      supplier_lot: "HS-1",
      stock_code: "hs_exact",
    });
  });

  test("Rescan sets the piece read aside, for the scanner again", async ({ page }) => {
    await onThePiece(page);
    await typeCode(page, "MM-STD-5120-A");
    await page.getByRole("button", { name: techCopy.steps.piece.confirmed.rescan }).click();
    await expect(page.getByText(techCopy.steps.piece.pointAt)).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
  });

  test("says so when no camera opens, and the code can still be typed", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: () => Promise.reject(new Error("No camera")) },
      });
    });
    await onThePiece(page);
    await expect(page.getByRole("alert").filter({ hasText: techCopy.steps.piece.camera.refused })).toBeVisible();
    await typeCode(page, "MM-STD-5120-A");
    await expect(page.getByRole("region", { name: "MM-STD-5120-A" })).toBeVisible();
  });

  test("with no signal says the label is not checked, rather than unknown", async ({ page }) => {
    const fake = await onThePiece(page);
    fake.online = false;
    // Checked as it reads: no button to press first.
    await typeCode(page, "MM-STD-7193-C");

    await expect(page.getByText(techCopy.steps.piece.offline)).toBeVisible();
    // It can be tried again once there is signal.
    await expect(page.getByRole("button", { name: techCopy.steps.piece.checkAgain })).toBeVisible();
    await expect(stepAction(page)).toBeEnabled();
  });

  // A label taken while another is still being checked gets its own answer, and nothing of the first's.
  test("checks a label taken while another is still being checked, and takes nothing of the first", async ({
    page,
  }) => {
    const fake = await onThePiece(page);
    let first = true;
    await page.route("**/api/tech/pieces/lookup**", async (route) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.fallback();
    });
    await typeCode(page, ROHITS_PIECE.piece_code);
    await typeCode(page, "MM-STD-9998-Z");

    await expect(page.getByText(techCopy.steps.piece.unknown)).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(page.getByText(techCopy.steps.piece.unknown)).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
    expect(writesTo(fake, "piece")).toEqual([]);
  });

  test("will not record another client’s piece", async ({ page }) => {
    await onThePiece(page);
    await typeCode(page, "MM-STD-9999-Z");

    await expect(page.getByRole("alert").filter({ hasText: techCopy.steps.piece.notThisClient })).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.notThisClientAction, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
  });

  // Opened again after its piece landed, the step named the new piece as the one coming off.
  test("opened again after its piece landed, still replaces the piece worn before the visit", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "replacement";
    fake.pieces = [{ ...ROHITS_PIECE, piece_code: "MM-STD-5120-A", fitted_at: todayInIndia() }, WORN];
    fake.kitHairSystems = holding("standard", "MM-STD-5120-A");
    startedThrough(fake, "before_photos", "piece");
    await page.goto(`/jobs/${JOB_ID}/piece`);
    await expect(page.getByText(techCopy.steps.piece.listed("MM-STD-4417-B", "2 Jul"))).toBeVisible();
    await expect(page.getByText(/^MM-STD-5120-A · fitted/)).toHaveCount(0);
  });

  test("on a replacement sends the piece on the client’s head as the one that came off, with no why", async ({
    page,
  }) => {
    const fake = await onThePiece(page);
    await typeCode(page, "MM-STD-5120-A");
    await stepAction(page).click();
    await expect(
      page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.replacement }),
    ).toBeVisible();
    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toMatchObject({
      piece_code: "MM-STD-5120-A",
      stock_code: "hs_standard",
      old_piece: { piece_code: "MM-STD-4417-B" },
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
    await expect(page.getByText(techCopy.oneVisit.chooseFirst, { exact: true })).toBeVisible();
    await expect(stepAction(page)).toBeDisabled();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("radio", { name: "Mane Man Natural", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Mane Man Natural", exact: true })).toBeChecked();
    await typeCode(page, "MM-NAT-5120-A");
    await stepAction(page).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({
      piece_code: "MM-NAT-5120-A",
      base: "Kit stock MM-NAT-5120-A",
      product: "natural",
      stock_code: "hs_natural",
    });
  });

  test("records that the client decided against it, and asks for no label", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("radio", { name: techCopy.oneVisit.declined, exact: true }).click();
    await expect(page.getByText(techCopy.oneVisit.declinedNote)).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.pointAt)).toHaveCount(0);
    await expect(stepAction(page)).toHaveText(techCopy.visit.next(techCopy.steps.checklistTitles.consultation));
    await expect(page.getByRole("button", { name: techCopy.steps.piece.cannotFit.action })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    await stepAction(page).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ declined: true });
  });

  // The fit's items are never asked of a technician who fitted nothing.
  test("runs the consultation’s checklist alone once the client decided against the fit", async ({ page }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("radio", { name: techCopy.oneVisit.declined, exact: true }).click();
    await stepAction(page).click();

    await expect(
      page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.consultation }),
    ).toBeVisible();
    await expect(page.getByText(techCopy.visit.task(1, 3))).toBeVisible();
    await throughTheTasks(page);
    await expect(page.getByRole("button", { name: /Adhesive applied/ })).toHaveCount(0);
    await stepAction(page).click();

    await expect.poll(() => writesTo(fake, "checklist").length).toBe(1);
    expect(writesTo(fake, "checklist")[0]?.body).toEqual({
      done: ["scalp_checked", "measurements_taken", "options_shown"],
    });
  });

  test("runs the consultation’s checklist and the fit’s for a client being fitted", async ({ page }) => {
    await onTheChoice(page);
    await page.getByRole("radio", { name: "Mane Man Natural" }).click();
    await typeCode(page, "MM-NAT-5120-A");
    await stepAction(page).click();

    await expect(page.getByRole("heading", { level: 1, name: techCopy.oneVisit.checklist })).toBeVisible();
    await expect(page.getByText(techCopy.visit.task(1, 9))).toBeVisible();
  });

  // A fit today needs the hair system in the kit (docs/prompts/tech-redesign.md, "Outcome").
  test("books the fit for later for a hair system the kit does not hold, and offers no fit today", async ({ page }) => {
    await onTheChoice(page);
    await page.getByRole("radio", { name: "Mane Man Essential", exact: true }).click();

    const today = page.getByRole("radio", { name: new RegExp(`^${techCopy.oneVisit.fitToday}`) });
    await expect(today).toBeDisabled();
    await expect(page.getByText(techCopy.oneVisit.notInKit("Mane Man Essential"))).toBeVisible();
    await expect(page.getByRole("radio", { name: new RegExp(techCopy.oneVisit.bookLater) })).toBeChecked();
    await expect(page.getByText(techCopy.steps.piece.pointAt)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });

  // The client chose the product and books the fit for another day (docs/decisions/0247-the-steps-left.md).
  test("books the fit for another day: no label asked, the product sent, the consultation’s checklist", async ({
    page,
  }) => {
    const fake = await onTheChoice(page);
    await page.getByRole("radio", { name: "Mane Man Natural" }).click();
    // Fit today, unless the client books it for later.
    await expect(page.getByRole("radio", { name: new RegExp(`^${techCopy.oneVisit.fitToday}`) })).toBeChecked();
    await page.getByRole("radio", { name: new RegExp(techCopy.oneVisit.bookLater) }).click();
    await expect(page.getByText(techCopy.oneVisit.laterNote)).toBeVisible();
    await expect(page.getByText(techCopy.steps.piece.pointAt)).toHaveCount(0);
    // Nothing is fitted today: the consultation's checklist is next, and there is no fit to give up on.
    await expect(stepAction(page)).toHaveText(techCopy.visit.next(techCopy.steps.checklistTitles.consultation));
    await expect(page.getByRole("button", { name: techCopy.steps.piece.cannotFit.action })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    await stepAction(page).click();

    await expect.poll(() => writesTo(fake, "piece").length).toBe(1);
    expect(writesTo(fake, "piece")[0]?.body).toEqual({ product: "natural", fit_later: true });
    await expect(
      page.getByRole("heading", { level: 1, name: techCopy.steps.checklistTitles.consultation }),
    ).toBeVisible();
  });

  // Nothing is fitted, so nothing used is what was expected, and asks no reason, as the API asks none.
  test("counts nothing used on a fit booked for later with no reason asked", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.type = "first_fit";
    fake.oneVisit = true;
    fake.clientChoice = { product: "natural", fit_later: true };
    startedThrough(fake, "before_photos", "piece", "checklist", "profile");
    await page.goto(`/jobs/${JOB_ID}/consumables`);
    await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.consumables })).toBeVisible();

    await expect(page.getByText(techCopy.steps.consumables.whyNone)).toHaveCount(0);
    await stepAction(page).click();
    await expect.poll(() => writesTo(fake, "consumables").length).toBe(1);
    expect(writesTo(fake, "consumables")[0]?.body).toEqual({ items: [] });
  });

  test("closes a fit booked for later as a consultation going ahead, with nothing to pay now", async ({ page }) => {
    const fake = await atTheOutcome(page, { product: "natural", fit_later: true });
    await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();

    await expect(page.getByText(techCopy.oneVisit.endsGoingAhead("Mane Man Natural"))).toBeVisible();
    await expect(page.getByText(/payment link/)).toHaveCount(0);
    await expect(page.getByLabel(techCopy.oneVisit.code.label)).toHaveCount(0);
    await expect(stepAction(page)).toHaveText(techCopy.visit.close);
    expect(await axeViolations(page)).toEqual([]);

    await stepAction(page).click();
    await expect(page.getByText(/^Rohit M\. · .+ · fit to book$/)).toBeVisible();
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", going_ahead: true, product: "natural" });
  });

  // A declined visit offers no code and promises no link, and closes as what it became.
  test("ends a declined visit as a free consultation, with no code asked for, and closes as one", async ({ page }) => {
    const fake = await atTheOutcome(page, { declined: true }, { code: "AUDTEST", given_by: "client" });
    await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();

    await expect(page.getByText(techCopy.oneVisit.endsAsConsultation)).toBeVisible();
    await expect(page.getByText(/payment link/)).toHaveCount(0);
    await expect(page.getByText(/AUDTEST/)).toHaveCount(0);
    await expect(page.getByLabel(techCopy.oneVisit.code.label)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);

    await stepAction(page).click();
    await expect(page.getByText(/^Rohit M\. · .+ · free consultation$/)).toBeVisible();
    // Declined, the client is not going ahead with the fit, and the close says so.
    expect(writesTo(fake, "outcome").at(-1)?.body).toEqual({ outcome: "done", going_ahead: false });
  });

  test("names the product the payment link is for, once the client chose it", async ({ page }) => {
    await atTheOutcome(page, { product: "natural" });
    await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
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
    await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
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
    await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
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
