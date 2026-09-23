// One client's page (boards B2 and B3): finding them by their mobile number,
// their photographs, which are audited before they are shown, and their
// consents, which ops read and never change. The API is answered from
// e2e/ops/fixtures.ts, since no route seeds a client's photographs.

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  CLIENT,
  CONSENTS,
  ERASURE_REQUESTED,
  fails,
  inkPhoto,
  jpeg,
  json,
  PHOTOS,
  RECORD,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RECORD_PATH = `/api/clients/${CLIENT.id}`;
const NAME = { name: CLIENT.name, exact: true };

type Answers = Readonly<Record<string, (route: Route) => Promise<void>>>;

/** The client's routes, with every photograph a block of ink; `over` replaces any of them. */
async function clientRoutes(page: Page, over: Answers = {}): Promise<void> {
  const bytes = await inkPhoto();
  const photos: Record<string, (route: Route) => Promise<void>> = {};
  for (const shot of PHOTOS.visits[0]?.photos ?? []) photos[`${RECORD_PATH}/photos/${shot.id}`] = jpeg(bytes);
  await answer(page, {
    [RECORD_PATH]: json(RECORD),
    [`${RECORD_PATH}/photos`]: json(PHOTOS),
    [`${RECORD_PATH}/consents`]: json(CONSENTS),
    ...photos,
    ...over,
  });
}

async function openClient(page: Page, path: string, over: Answers = {}): Promise<void> {
  await clientRoutes(page, over);
  await page.goto(path);
}

test("finds a client by their number, and sends the number in the body, never in the URL", async ({ page }) => {
  await answer(page, { "/api/clients/search": json(CLIENT), [RECORD_PATH]: json(RECORD) });
  await page.goto("/clients");

  const sent = page.waitForRequest((request) => request.url().includes("/clients/search"));
  await page.getByLabel("The client's mobile number").fill("98100 04417");
  await page.getByRole("button", { name: "Find the client" }).click();

  const request = await sent;
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual({ mobile: "98100 04417" });
  expect(new URL(request.url()).search).toBe("");
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/clients/${CLIENT.id}`);
});

test("says so when nobody holds the number", async ({ page }) => {
  await answer(page, { "/api/clients/search": fails(404, "not_found") });
  await page.goto("/clients");
  await page.getByLabel("The client's mobile number").fill("98100 04417");
  await page.getByRole("button", { name: "Find the client" }).click();
  await expect(page.getByRole("alert")).toContainText("Nobody has that number.");
});

test("heads the page with the client's standing, from the record", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  await expect(page.getByText("Fitted")).toBeVisible();
  await expect(page.getByText("2 · expire 3 Jan 2028")).toBeVisible();
});

test("keeps the photographs locked, and says what opening them records", async ({ page }) => {
  let asked = 0;
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [`${RECORD_PATH}/photos`]: (route) => {
      asked += 1;
      return json(PHOTOS)(route);
    },
  });
  await expect(page.getByText("Locked")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Photographs of ${CLIENT.name}` })).toBeVisible();
  await expect(page.getByText("Opening these records your name, the client and the time.")).toBeVisible();
  // Nothing is fetched while it is locked, so nothing is logged.
  expect(asked).toBe(0);
  await expect(page.getByRole("img")).toHaveCount(0);
});

test("opens the photographs, which the API audits before it serves them", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/photos`);
  const served = page.waitForRequest((request) => /\/photos\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname));
  await page.getByRole("button", { name: "View photos" }).click();

  await served;
  await expect(page.getByText(/^Open · logged /)).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(10);
  await expect(page.getByText("Before")).toBeVisible();
  await expect(page.getByText("After")).toBeVisible();
  await expect(page.getByText("22 Aug 2027 · service visit · Imran Qureshi")).toBeVisible();
});

test("shows no photograph the API would not record the view of", async ({ page }) => {
  const bytes = await inkPhoto();
  const first = PHOTOS.visits[0]?.photos[0]?.id ?? "";
  const photos: Record<string, (route: Route) => Promise<void>> = {};
  for (const shot of PHOTOS.visits[0]?.photos ?? []) photos[`${RECORD_PATH}/photos/${shot.id}`] = jpeg(bytes);
  photos[`${RECORD_PATH}/photos/${first}`] = fails(503, "unavailable");
  await answer(page, {
    [RECORD_PATH]: json(RECORD),
    [`${RECORD_PATH}/photos`]: json(PHOTOS),
    ...photos,
  });
  await page.goto(`/clients/${CLIENT.id}/photos`);
  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("alert")).toContainText("The view could not be recorded");
  await expect(page.getByRole("img")).toHaveCount(9);
});

test("lists every consent with its state, date and notice, and says ops cannot grant one", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`);
  const row = (purpose: string) => page.getByRole("row").filter({ hasText: purpose });
  await expect(row("Photographs for the client record")).toContainText("14 Nov 2026");
  await expect(row("Photographs on referral cards")).toContainText("v2");
  await expect(row("Photographs in marketing")).toContainText("Not given");
  await expect(row("WhatsApp about launches")).toContainText("Withdrawn");
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  // Read only: the tab offers no way to change one.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("says when the client has asked to be erased", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, {
    [`${RECORD_PATH}/consents`]: json(ERASURE_REQUESTED),
  });
  await expect(page.getByText("Erasure requested 18 Sep 2027. It is not decided here.")).toBeVisible();
});

test("moves between the two tabs without reading the record again", async ({ page }) => {
  let records = 0;
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [RECORD_PATH]: (route) => {
      records += 1;
      return json(RECORD)(route);
    },
  });
  await expect(page.getByText("Locked")).toBeVisible();
  await page.getByRole("link", { name: "Consents" }).click();
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  await page.getByRole("link", { name: "Photos" }).click();
  // Coming back locks them again: a second look is a second entry in the log.
  await expect(page.getByText("Locked")).toBeVisible();
  expect(records).toBe(1);
});

test("says so when the client cannot be loaded, and loads them on Try again", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [RECORD_PATH]: fails(503, "unavailable") });
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await clientRoutes(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
});

test("meets WCAG 2.2 AA finding a client, and on both tabs, locked and open", async ({ page }) => {
  const clean = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      label,
    ).toEqual([]);
  };

  await answer(page, { "/api/clients/search": json(CLIENT) });
  await page.goto("/clients");
  await expect(page.getByRole("button", { name: "Find the client" })).toBeVisible();
  await clean("/clients");

  await openClient(page, `/clients/${CLIENT.id}/photos`);
  await expect(page.getByText("Locked")).toBeVisible();
  await clean("photos, locked");

  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("img").first()).toBeVisible();
  await clean("photos, open");

  await page.getByRole("link", { name: "Consents" }).click();
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  await clean("consents");
});
