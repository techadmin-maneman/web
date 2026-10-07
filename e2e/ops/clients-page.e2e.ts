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

// What a client has bought and how
// often they have been served belongs on the ops console as well as in the app.
test("counts the client's visits and replacements, and the day their piece falls due", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/history`);
  const history = page.getByRole("region", { name: "Overview" });
  const fact = (label: string) =>
    history
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("+ dd");
  await expect(fact("First fit")).toHaveText("14 Nov 2026");
  await expect(fact("Visits")).toHaveText("6");
  await expect(fact("Service visits")).toHaveText("4");
  await expect(fact("Replacements")).toHaveText("1");
  await expect(fact("Last visit")).toHaveText("22 Aug 2027");
  // Ops order a piece against a day, so this tab carries one; only the client is told the month alone.
  await expect(fact("Replacement due")).toHaveText("1 Mar 2028 · MM-STD-4417-C");
  await expect(fact("Paid")).toHaveText("Rs. 49,560");
});

test("writes a client with no record in words, and their true noughts as noughts", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/history`, { [READ_RECORD]: json(NEW_RECORD) });
  const history = page.getByRole("region", { name: "Overview" });
  const fact = (label: string) =>
    history
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("+ dd");
  await expect(fact("First fit")).toHaveText("No first fit");
  await expect(fact("Last visit")).toHaveText("No visits yet");
  await expect(fact("Replacement due")).toHaveText("No hair system fitted");
  await expect(fact("Service visits")).toHaveText("0");
  await expect(fact("Paid")).toHaveText("Rs. 0");
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
  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("img")).toHaveCount(10);
  await page.getByRole("link", { name: "Consents" }).click();
  await page.getByRole("link", { name: "Hair" }).click();
  await expect(page.getByText("MM-STD-4417-C")).toBeVisible();
  // Visits, Payments and History are drawn from the record already loaded, so they ask the API for nothing.
  await page.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
  await clientTab(page, "Payments").click();
  await expect(page.getByRole("region", { name: "Payments and refunds" })).toContainText(
    "Service visit of 22 Aug 2027",
  );
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  // Coming back finds the same opening, logged once: a tab changed is not a second look.
  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Open · logged 10:42 am")).toBeVisible();
  expect(records).toBe(1);
  expect(views).toBe(1);
});

test("says so when the client cannot be loaded, and loads them on Try again", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [READ_RECORD]: fails(503, "unavailable") });
  await expect(page.getByRole("alert")).toContainText("Couldn't load this.");

  await clientRoutes(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
});

test("meets WCAG 2.2 AA finding a client, and on every tab, locked and open", async ({ page }) => {
  const clean = async (label: string) => {
    expect(await axeViolations(page), label).toEqual([]);
  };

  await answer(page, { [FIND]: json({ clients: [FOUND], more: false }) });
  await page.goto("/clients");
  await page.getByLabel("Name or number").fill("malhotra");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("link", NAME)).toBeVisible();
  await clean("/clients");

  await openClient(page, `/clients/${CLIENT.id}/pieces`);
  await expect(page.getByText("MM-STD-4417-C")).toBeVisible();
  await clean("pieces");

  await page.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
  await clean("visits");

  await clientTab(page, "Payments").click();
  await expect(page.getByRole("region", { name: "Free service visits" })).toBeVisible();
  await clean("payments");

  await clientTab(page, "Referrals").click();
  await expect(page.getByRole("region", { name: "Invite" })).toBeVisible();
  await clean("referrals");

  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Locked")).toBeVisible();
  await clean("photos, locked");

  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("img").first()).toBeVisible();
  await clean("photos, open");

  await page.getByRole("link", { name: "Consents" }).click();
  await clean("consents");

  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
  await clean("history");
});
