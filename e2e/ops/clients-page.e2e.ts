import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, CLIENT, fails, json, NEW_RECORD, RECORD } from "./fixtures.ts";
import {
  READ_RECORD,
  VIEW_PHOTOS,
  FIND,
  NAME,
  FOUND,
  VIEW,
  clientRoutes,
  openClient,
  clientTab,
} from "./clients-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { care } from "../../apps/ops/src/content/care.ts";

/** A fact's value in a region of the page, by its name. */
const factIn = (page: Page, region: string) => (label: string) =>
  page
    .getByRole("region", { name: region })
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("+ dd");

// What a client has bought and how often they have been served belongs on the ops console as well as in the app.
// The visits, when the piece falls due and what was paid stand at the page's right; History has the rest.
test("counts the client’s visits and replacements, and the month their piece falls due", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/history`);
  const fact = factIn(page, opsCopy.clients.history.title);
  await expect(fact("First fit")).toHaveText("14 Nov");
  await expect(fact("Service visits")).toHaveText("4");
  await expect(fact("Replacements")).toHaveText("1");
  await expect(fact("Last visit")).toHaveText("22 Aug 2027");
  const glance = factIn(page, opsCopy.clients.glance.title);
  await expect(glance(opsCopy.clients.glance.visits)).toHaveText("6");
  await expect(glance(opsCopy.clients.glance.replaceBy)).toHaveText("Mar 2028");
});

test("writes a client with no record in words, and their true noughts as noughts", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/history`, { [READ_RECORD]: json(NEW_RECORD) });
  const fact = factIn(page, opsCopy.clients.history.title);
  await expect(fact("First fit")).toHaveText(opsCopy.clients.history.noFirstFit);
  await expect(fact("Last visit")).toHaveText(opsCopy.clients.history.noVisit);
  await expect(fact("Service visits")).toHaveText("0");
  const glance = factIn(page, opsCopy.clients.glance.title);
  await expect(glance(opsCopy.clients.glance.replaceBy)).toHaveText(opsCopy.clients.noPiece);
  await expect(glance(opsCopy.clients.glance.paid)).toHaveText("Rs. 0");
  await expect(glance(opsCopy.clients.glance.visits)).toHaveText("0");
});

test("moves between the tabs without reading the record again, and keeps the photographs open", async ({ page }) => {
  let records = 0;
  let views = 0;
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [READ_RECORD]: (route) => {
      records += 1;
      return json(RECORD)(route);
    },
    [VIEW_PHOTOS]: (route) => {
      views += 1;
      return json(VIEW)(route);
    },
  });
  await page.getByRole("button", { name: opsCopy.clients.photos.open }).click();
  await expect(page.getByRole("img")).toHaveCount(10);
  await page.getByRole("link", { name: opsCopy.clients.consents.title }).click();
  await page.getByRole("link", { name: opsCopy.clients.photos.angles.hair }).click();
  await expect(page.getByText("MM-STD-4417-C")).toBeVisible();
  // Visits, Payments and History are drawn from the record already loaded, so they ask the API for nothing.
  await clientTab(page, opsCopy.clients.tabs[0].label).click();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
  await clientTab(page, "Payments").click();
  await expect(page.getByRole("region", { name: opsCopy.clients.payments.title })).toContainText(
    "Service visit of 22 Aug 2027",
  );
  await page.getByRole("link", { name: opsCopy.clients.history.title }).click();
  await expect(page.getByRole("region", { name: opsCopy.clients.history.title })).toBeVisible();
  // Coming back finds the same opening, logged once: a tab changed is not a second look.
  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Open · logged 10:42 am")).toBeVisible();
  expect(records).toBe(1);
  expect(views).toBe(1);
});

test("says so when the client cannot be loaded, and loads them on Try again", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [READ_RECORD]: fails(503, "unavailable") });
  await expect(page.getByRole("alert")).toContainText(opsCopy.states.failed);

  await clientRoutes(page);
  await page.getByRole("button", { name: opsCopy.clients.visits.book.retry }).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
});

test("says there is no client at a link that names nobody, with the way back to Clients", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [READ_RECORD]: fails(404, "not_found") });
  await expect(page.getByRole("heading", { name: opsCopy.clients.missing })).toBeVisible();
  await expect(page.getByRole("button", { name: opsCopy.states.retry })).toHaveCount(0);
  await expect(page.getByRole("link", { name: opsCopy.clients.erasure.done.back })).toHaveAttribute("href", "/clients");
});

test("meets WCAG 2.2 AA finding a client, and on every tab, locked and open", async ({ page }) => {
  const clean = async (label: string) => {
    expect(await axeViolations(page), label).toEqual([]);
  };

  await answer(page, { [FIND]: json({ clients: [FOUND], more: false }) });
  await page.goto("/clients");
  await page.getByLabel(opsCopy.clients.find.label).fill("malhotra");
  await page.getByLabel(opsCopy.clients.find.label).press("Enter");
  await expect(page.getByRole("link", NAME)).toBeVisible();
  await clean("/clients");

  await openClient(page, `/clients/${CLIENT.id}/pieces`);
  await expect(page.getByText("MM-STD-4417-C")).toBeVisible();
  await clean("pieces");

  await clientTab(page, opsCopy.clients.tabs[0].label).click();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
  await clean("visits");

  await clientTab(page, "Payments").click();
  await expect(page.getByRole("region", { name: opsCopy.clients.meta.credits })).toBeVisible();
  await clean("payments");

  await clientTab(page, "Referrals").click();
  await expect(page.getByRole("region", { name: opsCopy.clients.invite.title })).toBeVisible();
  await clean("referrals");

  await clientTab(page, "Messages").click();
  await expect(page.getByText(care.clientChat.none)).toBeVisible();
  await clean("messages");

  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText(opsCopy.clients.photos.locked)).toBeVisible();
  await clean("photos, locked");

  await page.getByRole("button", { name: opsCopy.clients.photos.open }).click();
  await expect(page.getByRole("img").first()).toBeVisible();
  await clean("photos, open");

  await page.getByRole("link", { name: opsCopy.clients.consents.title }).click();
  await clean("consents");

  await page.getByRole("link", { name: opsCopy.clients.history.title }).click();
  await expect(page.getByRole("region", { name: opsCopy.clients.history.title })).toBeVisible();
  await clean("history");
});
