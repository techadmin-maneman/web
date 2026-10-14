// Board B's in-job steps under a gloved hand: one tap is one write, a label is
// checked before it can strand the close-out, the piece step takes what the
// pieces tab needs, and every step says where the technician is.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ROHITS_PROFILE, type HairProfile } from "./fixtures.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { deviceRecordOnPhone } from "./on-phone.ts";
import { startedThrough, writesTo, gilded } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

// The client's hair profile, which no board draws: the fit spec, then the history, sent as one write, on no consent
// of its own (docs/decisions/0106-a-clients-hair-profile.md).
test.describe("the client’s hair profile", () => {
  async function atTheProfile(page: Page, profile: HairProfile | null = null): Promise<Fake> {
    const fake = await fakeTech(page);
    fake.type = "consultation";
    fake.profile = profile;
    startedThrough(fake, "before_photos", "checklist", "consumables");
    await page.goto(`/jobs/${JOB_ID}/profile`);
    await expect(page.getByRole("heading", { level: 1, name: "Hair profile" })).toBeVisible();
    return fake;
  }

  const next = (page: Page) => page.getByRole("button", { name: techCopy.steps.next });

  test("takes the fit spec, then the history, and sends them as one", async ({ page }) => {
    const fake = await atTheProfile(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("radio", { name: "IV", exact: true }).click();
    await page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm }).fill("57.5");
    await page.getByRole("textbox", { name: techCopy.profile.measurements.base_width_in }).fill("8");
    await page.getByRole("textbox", { name: techCopy.profile.measurements.base_length_in }).fill("10");
    // The base in centimetres too, as the head above it is measured.
    await expect(page.getByText("20.3 × 25.4 cm")).toBeVisible();
    // Each field's choices are one group named by its title, so "Straight" says whether it is the wave or the hairline.
    for (const field of ["Wave", "Hairline"]) {
      await expect(page.getByRole("radiogroup", { name: field }).getByRole("radio", { name: "Straight" })).toHaveCount(
        1,
      );
    }
    // The suppliers' order, not #1 … #8 then #1B.
    await expect(page.getByRole("radiogroup", { name: "Colour", exact: true }).getByRole("radio")).toHaveText([
      "#1",
      "#1B",
      "#2",
      "#3",
      "#4",
      "#5",
      "#6",
      "#7",
      "#8",
    ]);
    await page.getByRole("radio", { name: "#1B" }).click();
    await page.getByRole("radio", { name: techCopy.profile.densities["120"] }).click();
    await page.getByRole("radio", { name: "Mane Man Natural" }).click();
    await page.getByRole("radio", { name: techCopy.profile.attachments.tape, exact: true }).click();
    expect(await gilded(page)).toEqual(["Next"]);
    await next(page).click();

    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await page.getByRole("button", { name: techCopy.profile.remedies.minoxidil }).click();
    await page.getByRole("button", { name: techCopy.profile.remedies.transplant }).click();
    await page.getByRole("textbox", { name: techCopy.profile.history.year }).fill("2019");
    await page.getByRole("textbox", { name: techCopy.profile.history.skin }).fill("Dry at the crown");
    expect(await axeViolations(page)).toEqual([]);
    await next(page).click();

    // A consultation takes no after photographs, so the outcome follows.
    await expect(page.getByRole("heading", { level: 1, name: "Outcome" })).toBeVisible();
    await expect.poll(() => writesTo(fake, "profile").length).toBe(1);
    expect(writesTo(fake, "profile")[0]?.body).toEqual({
      fit: {
        norwood_stage: "IV",
        head_circumference_cm: 57.5,
        front_to_nape_cm: null,
        ear_to_ear_cm: null,
        temple_to_temple_cm: null,
        base_width_in: 8,
        base_length_in: 10,
        colour: "1B",
        grey_percent: null,
        density_percent: 120,
        wave: null,
        hairline: null,
        product: "natural",
        attachment: "tape",
      },
      history: { remedies: ["minoxidil", "transplant"], transplant_year: 2019, skin_and_allergies: "Dry at the crown" },
      // No version stood before this one.
      based_on: null,
    });
  });

  test("keeps what was typed when the app closes part-way, and lets it go once sent", async ({ page }) => {
    const fake = await atTheProfile(page);
    await page.getByRole("radio", { name: "IV", exact: true }).click();
    await page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm }).fill("57.5");
    await page.getByRole("textbox", { name: techCopy.profile.measurements.base_width_in }).fill("8");
    await page.getByRole("textbox", { name: techCopy.profile.measurements.base_length_in }).fill("10");
    await page.getByRole("radio", { name: "Mane Man Natural" }).click();
    await page.getByRole("radio", { name: techCopy.profile.attachments.tape, exact: true }).click();
    await next(page).click();
    await page.getByRole("textbox", { name: techCopy.profile.history.skin }).fill("Dry at the crown");
    // The draft is written as it is typed; a slow phone may still be writing the last of it.
    await expect.poll(() => deviceRecordOnPhone(page, "profile_draft")).toContain("Dry at the crown");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: techCopy.profile.history.skin })).toHaveValue("Dry at the crown");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm })).toHaveValue(
      "57.5",
    );
    await expect(page.getByRole("radio", { name: "IV", exact: true })).toBeChecked();

    await next(page).click();
    await next(page).click();
    await expect.poll(() => writesTo(fake, "profile").length).toBe(1);
    await page.goto(`/jobs/${JOB_ID}/profile`);
    await expect(page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm })).toHaveValue(
      "",
    );
  });

  test("keeps Next dim on a figure out of its range, and says the range", async ({ page }) => {
    await atTheProfile(page);
    const circumference = page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm });
    await circumference.fill("90");
    await expect(circumference).toHaveAccessibleDescription("40–70, to one decimal.");
    const named = techCopy.profile.checkFigure(techCopy.profile.measurements.head_circumference_cm);
    await expect(page.getByRole("button", { name: named })).toBeDisabled();
    await circumference.fill("57.5");
    await expect(next(page)).toBeEnabled();
  });

  test("starts from the profile as it stands, names it, and sends no history where none was said", async ({ page }) => {
    const fake = await atTheProfile(page, { ...ROHITS_PROFILE, history: null });
    await expect(page.getByRole("radio", { name: "IV", exact: true })).toBeChecked();
    await expect(page.getByRole("textbox", { name: techCopy.profile.measurements.head_circumference_cm })).toHaveValue(
      "57.5",
    );
    await next(page).click();
    await next(page).click();

    await expect.poll(() => writesTo(fake, "profile").length).toBe(1);
    expect(writesTo(fake, "profile")[0]?.body).toMatchObject({
      fit: { colour: "1B", product: "essential" },
      history: null,
      based_on: ROHITS_PROFILE.id,
    });
  });

  test("puts the profile’s hair system, colour, adhesive and scalp on the card’s hair profile", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.profile = ROHITS_PROFILE;
    await page.goto(`/jobs/${JOB_ID}`);
    const card = page.getByRole("region", { name: "Hair profile" });
    await expect(card.getByText("Mane Man Essential")).toBeVisible();
    await expect(card.getByText("8 × 10 in")).toBeVisible();
    await expect(card.getByText("#1B / 20% grey")).toBeVisible();
    await expect(card.getByText(techCopy.profile.attachments.tape, { exact: true })).toBeVisible();
    await expect(card.getByText("Dry at the crown")).toBeVisible();
  });
});
