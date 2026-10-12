// One client's page: finding them by part of their name or
// number, the ways to reach them, what waits on Tasks for them, their visits,
// pieces, payments and invite, their photographs, which are opened as one logged
// view, and their consents, which ops read and never change. The API is answered from e2e/ops/fixtures.ts,
// since no route seeds a client's pieces or photographs.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, fails, HAIR_PROFILE, json, NEW_RECORD, type Call, type OpsReply } from "./fixtures.ts";
import {
  NO_STOCK_MATCH,
  RECORD_PATH,
  READ_RECORD,
  READ_HAIR_PROFILE,
  READ_STOCK_MATCH,
  openClient,
} from "./clients-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { stockMatch as matchCopy } from "../../apps/ops/src/content/stock-match.ts";

const CORRECT_HAIR_PROFILE: Call = `POST ${RECORD_PATH}/hair-profile`;

const SUGGEST: Call = `POST ${RECORD_PATH}/address/suggestions`;

const SAVE_ADDRESS: Call = `POST ${RECORD_PATH}/address`;

// The client's hair profile, which no board draws, above the pieces (docs/decisions/0106-a-clients-hair-profile.md).
test.describe("the client's hair profile", () => {
  const section = (page: Page) => page.getByRole("region", { name: opsCopy.clients.profile.title });

  test("stands above the pieces: the latest, its history, and every version with who recorded it", async ({ page }) => {
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_HAIR_PROFILE]: json(HAIR_PROFILE) });
    const profile = section(page);
    await expect(profile.getByRole("definition").first()).toHaveText("IV");
    await expect(profile.locator("dl").first()).toContainText("Colour#2");
    await expect(profile.locator("dl").first()).toContainText("Skin conditions and allergiesDry at the crown");
    await expect(profile.getByRole("listitem")).toHaveText([
      /^22 Sep 2027 · ops@maneman\.in, correction/,
      /^21 Sep 2027 · Imran, at the consultation/,
    ]);
    await expect(page.getByRole("row").filter({ hasText: "MM-STD-4417-B" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("corrects it as a new version, the form starting from the latest", async ({ page }) => {
    const corrected = {
      ...HAIR_PROFILE,
      latest: { ...HAIR_PROFILE.latest, fit: { ...HAIR_PROFILE.latest.fit, colour: "3" as const } },
    };
    await openClient(page, `/clients/${CLIENT.id}/pieces`, {
      [READ_HAIR_PROFILE]: json(HAIR_PROFILE),
      [CORRECT_HAIR_PROFILE]: json(corrected),
    });
    await section(page).getByRole("button", { name: opsCopy.clients.profile.correct }).click();
    const colour = page.getByRole("combobox", { name: opsCopy.clients.profile.rows.colour });
    await expect(colour).toHaveValue("2");
    expect(await axeViolations(page)).toEqual([]);

    await colour.selectOption({ label: "#3" });
    const sent = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/hair-profile"),
    );
    await page.getByRole("button", { name: opsCopy.clients.profile.save }).click();
    const body = (await sent).postDataJSON() as { fit: Record<string, unknown>; history: unknown; based_on: unknown };
    expect(body.fit).toEqual({ ...HAIR_PROFILE.latest.fit, colour: "3", product_name: undefined });
    expect(body.history).toEqual(HAIR_PROFILE.latest.history);
    // The version the form was read from, so a correction never silently replaces a newer one.
    expect(body.based_on).toBe(HAIR_PROFILE.latest.id);
    await expect(section(page).locator("dl").first()).toContainText("Colour#3");
  });

  test("reads the profile again, saving nothing, when another version became the latest meanwhile", async ({
    page,
  }) => {
    const newer = {
      ...HAIR_PROFILE,
      latest: {
        ...HAIR_PROFILE.latest,
        id: "44000000-0000-4000-8000-000000000003",
        fit: { ...HAIR_PROFILE.latest.fit, colour: "4" as const },
      },
    } satisfies OpsReply<"/api/clients/{id}/hair-profile">;
    let reads = 0;
    await openClient(page, `/clients/${CLIENT.id}/pieces`, {
      [READ_HAIR_PROFILE]: (route) => {
        reads += 1;
        return json(reads === 1 ? HAIR_PROFILE : newer)(route);
      },
      [CORRECT_HAIR_PROFILE]: fails(409, "superseded"),
    });
    await section(page).getByRole("button", { name: opsCopy.clients.profile.correct }).click();
    await page.getByRole("button", { name: opsCopy.clients.profile.save }).click();

    await expect(section(page).getByRole("alert")).toContainText("The profile changed while you were editing.");
    await expect(section(page).locator("dl").first()).toContainText("Colour#4");
  });

  test("sends nothing while a figure is no number at all, and marks it", async ({ page }) => {
    let sent = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/hair-profile")) sent += 1;
    });
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_HAIR_PROFILE]: json(HAIR_PROFILE) });
    await section(page).getByRole("button", { name: opsCopy.clients.profile.correct }).click();
    await page.getByRole("textbox", { name: opsCopy.clients.profile.rows.grey_percent }).fill("twenty");
    await page.getByRole("button", { name: opsCopy.clients.profile.save }).click();
    await expect(page.getByRole("textbox", { name: opsCopy.clients.profile.rows.grey_percent })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByRole("alert")).toHaveText(opsCopy.clients.profile.refused);
    expect(sent).toBe(0);
  });

  test("marks the field the API refused", async ({ page }) => {
    await openClient(page, `/clients/${CLIENT.id}/pieces`, {
      [READ_HAIR_PROFILE]: json(HAIR_PROFILE),
      [CORRECT_HAIR_PROFILE]: fails(400, "invalid_request", ["fit.base_width_in"]),
    });
    await section(page).getByRole("button", { name: opsCopy.clients.profile.correct }).click();
    await page.getByRole("textbox", { name: opsCopy.clients.profile.rows.base_width_in }).fill("80");
    await page.getByRole("button", { name: opsCopy.clients.profile.save }).click();
    await expect(page.getByRole("alert")).toHaveText(opsCopy.clients.profile.refused);
    await expect(page.getByRole("textbox", { name: opsCopy.clients.profile.rows.base_width_in })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

// The record carried the address, the access notes and every visit, and the page showed none of them.
test("lists where visits go, and every visit to come and done", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`);
  await expect(page.getByText("House 1204, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();

  const coming = page.getByRole("region", { name: opsCopy.clients.visits.upcoming }).getByRole("row").nth(1);
  await expect(coming).toContainText("25 Sep 2027");
  await expect(coming).toContainText("9 am to 10:30 am");
  await expect(coming).toContainText("Service visit");
  await expect(coming).toContainText("Imran Qureshi");
  await expect(coming).toContainText("Booked · Prepaid");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("row").nth(1)).toContainText("22 Aug 2027");
  // A visit to come opens on the dispatch board, on its week with its drawer open; a visit done does not.
  await expect(coming.getByRole("link", { name: "Show on board: the visit of 25 Sep 2027" })).toHaveAttribute(
    "href",
    "/dispatch?from=2027-09-25&visit=33000000-0000-4000-8000-000000000002",
  );
  await expect(page.getByRole("region", { name: "Done" }).getByRole("link", { name: /Show on board/ })).toHaveCount(0);
});

test("says so when there is no address and no visit either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(page.getByText(opsCopy.clients.visits.noAddress)).toBeVisible();
  await expect(page.getByText(opsCopy.clients.visits.noUpcoming)).toBeVisible();
  await expect(page.getByText(opsCopy.clients.visits.noPast)).toBeVisible();
});

// An address a client gives ops on the phone, saved as theirs and marked as given to ops (ADR 0092; open point 62).
test("records an address the client gives on the phone, with the building found, and says whose it was", async ({
  page,
}) => {
  const saved: unknown[] = [];
  const GIVEN = {
    line1: "Sunrise Greens",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: null,
    building: "Sunrise Greens",
    flat: "Flat 1203",
    floor: null,
    tower: "Tower C",
    landmark: null,
    given_to_ops: { by: "ops@localhost", at: "2027-09-22T05:12:00.000Z" },
  } satisfies OpsReply<"/api/clients/{id}/address", "post">;
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    [READ_RECORD]: json(NEW_RECORD),
    [SUGGEST]: json({
      suggestions: [{ place_id: "stub-place-sunrise", primary: "Sunrise Greens", secondary: "Sector 65, Gurugram" }],
      attribution: "Google Maps",
    }),
    [SAVE_ADDRESS]: async (route) => {
      saved.push(route.request().postDataJSON());
      await json(GIVEN)(route);
    },
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.given.open }).click();
  const form = page.getByRole("form", { name: opsCopy.clients.visits.given.title });
  await form.getByRole("combobox", { name: opsCopy.clients.visits.given.building.label }).fill("Sunrise");
  await form.getByRole("option", { name: /Sunrise Greens/ }).click();
  await form.getByLabel(opsCopy.clients.visits.given.flat).fill("Flat 1203");
  await form.getByLabel(opsCopy.clients.visits.given.tower).fill("Tower C");
  await form.getByLabel(opsCopy.clients.visits.given.locality).fill("Sector 65");
  await form.getByLabel("City").fill("Gurgaon");
  await form.getByLabel("Pincode").fill("122018");
  expect(await axeViolations(page)).toEqual([]);
  await form.getByRole("button", { name: opsCopy.clients.visits.given.save }).click();

  await expect(page.getByText("Flat 1203, Tower C, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("To ops@localhost, 22 Sep 2027")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(opsCopy.clients.visits.given.saved);
  expect(saved).toEqual([
    expect.objectContaining({
      line1: "Sunrise Greens",
      building: "Sunrise Greens",
      place_id: "stub-place-sunrise",
      flat: "Flat 1203",
      pincode: "122018",
      session_token: expect.any(String),
    }),
  ]);
});

test("asks for what an address cannot do without before it sends one", async ({ page }) => {
  let sent = 0;
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    [READ_RECORD]: json(NEW_RECORD),
    [SAVE_ADDRESS]: async (route) => {
      sent += 1;
      await fails(400, "invalid_request")(route);
    },
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.given.open }).click();
  const form = page.getByRole("form", { name: opsCopy.clients.visits.given.title });
  await form.getByRole("button", { name: opsCopy.clients.visits.given.save }).click();
  await expect(form.getByRole("alert")).toContainText("Add the flat, building or street");
  await expect(form.getByLabel(opsCopy.clients.visits.given.flat)).toBeFocused();
  await expect(form.getByLabel(opsCopy.clients.visits.given.flat)).toHaveAttribute("required", "");
  expect(sent).toBe(0);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: opsCopy.clients.visits.given.open })).toBeFocused();
});

// The stock the client's profile matches, beneath it (docs/decisions/0173-matching-a-client-to-stock.md).
test.describe("the client's match to stock", () => {
  const section = (page: Page) => page.getByRole("region", { name: matchCopy.title });

  test("names the code made exactly to the profile and where its pieces are, their city first", async ({ page }) => {
    const stocked = {
      kind: "stocked" as const,
      missing: [],
      code: "hs_essential_8x10_1b_g20_d100",
      name: "Mane Man Essential 8x10 1B, 20% grey, 100%",
      city: "Gurgaon",
      held: [
        { place_id: "imran", name: "Imran Qureshi", kind: "kit", city: "Gurgaon", pieces: 1 },
        { place_id: "central", name: "National warehouse", kind: "warehouse", city: null, pieces: 4 },
      ],
      in_transit: 2,
    } satisfies OpsReply<"/api/clients/{id}/stock-match">;
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_STOCK_MATCH]: json(stocked) });
    const match = section(page);
    await expect(match).toContainText(matchCopy.matched(stocked.name));
    await expect(match).toContainText(matchCopy.held(1, "Imran Qureshi", "Gurgaon"));
    await expect(match).toContainText(matchCopy.held(4, "National warehouse", null));
    await expect(match).toContainText(matchCopy.inTransit(2));
    expect(await axeViolations(page)).toEqual([]);
  });

  test("says what the profile lacks, or that theirs is a custom order", async ({ page }) => {
    const incomplete = {
      ...NO_STOCK_MATCH,
      kind: "incomplete" as const,
      missing: ["grey_percent" as const, "density_percent" as const],
    };
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_STOCK_MATCH]: json(incomplete) });
    await expect(section(page)).toContainText("The profile needs grey and density to match stock.");
  });
});
