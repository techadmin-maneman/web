// Marking a pincode live from the waitlist, and telling those who wait in one
// already live (board C3; docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// e2e/ops/waitlist.e2e.ts holds the queue itself; this holds the panel.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, AREAS, json, LAUNCHED, PREVIEW, type Answers, type Call, type OpsReply } from "./fixtures.ts";

const BANDRA = "/api/pincodes/400050/launch";
const SECTOR_65 = "/api/pincodes/122018/launch";
const LAUNCH_BANDRA: Call = `POST ${BANDRA}`;
const LAUNCH_SECTOR_65: Call = `POST ${SECTOR_65}`;

/** Answers a launch route with `preview` while confirm is false, and `launched` once it is true. */
const launchRoute = (preview: object, launched: object) => (route: Route) => {
  const body = route.request().postDataJSON() as { confirm: boolean };
  return json(body.confirm ? launched : preview)(route);
};

async function open(page: Page, routes: Answers, areas: OpsReply<"/api/waitlist"> = AREAS) {
  await answer(page, { "GET /api/waitlist": json(areas), ...routes });
  await page.goto("/waitlist");
  await expect(page.getByRole("heading", { level: 1, name: "Waitlist" })).toBeVisible();
}

// FEO-15 of the audit, 24 September 2026: the panel opened 1,632 px down a 900 px window, and focus stayed put.
test("brings the panel into view and reads it from its head, however long the list", async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    pincode: String(400100 + index),
    area: "Cumballa",
    city: "Mumbai",
    served: false,
    launched_at: null,
    waiting: 64,
    oldest: "2027-03-19T06:00:00.000Z",
    referred: 12,
    alerts: 41,
  }));
  await open(page, { [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) }, { ...AREAS, areas: [...many, ...AREAS.areas] });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel).toBeFocused();
  await expect(panel).toBeInViewport();
});

// OPS-22: the panel sent today's date only, and had no field for the day a technician starts.
test("takes the day a technician starts coming, and sends it only when ops chose one", async ({ page }) => {
  await open(page, { [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await panel.getByLabel("Launch date").fill("2099-10-01");

  // The preview was the first call; the next is the launch.
  const sent = page.waitForRequest((request) => request.url().endsWith(BANDRA) && request.method() === "POST");
  await panel.getByRole("button", { name: "Send to 84" }).click();
  expect((await sent).postDataJSON()).toEqual({ confirm: true, launch_on: "2099-10-01" });
});

// OPS-22: "Send to 0" only marked the pincode live, and "The 1 who did not opt in are".
test("says what the press does when nobody asked to be told, in words that agree", async ({ page }) => {
  const quiet = { pincode: "400050", waiting: 1, alerts: 0, launched: false };
  await open(page, { [LAUNCH_BANDRA]: launchRoute(quiet, { ...quiet, launched: true }) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel).toContainText("This messages nobody");
  await expect(panel).toContainText("The 1 who did not opt in is not messaged.");
  await panel.getByRole("button", { name: "Mark it live" }).click();
  await expect(panel.getByRole("status")).toHaveText("Marked live. Nobody was messaged.");
});

// FEO-02: a pincode served from Settings showed "Live" with its waitlist untold and no way to tell them.
test("tells those still waiting in a pincode already live", async ({ page }) => {
  const left = { pincode: "122018", waiting: 4, alerts: 2, launched: false };
  await open(page, { [LAUNCH_SECTOR_65]: launchRoute(left, { ...left, launched: true }) });
  await page.getByRole("button", { name: "Tell those waiting in 122018, Sector 65" }).click();
  const panel = page.getByRole("region", { name: "Tell those waiting in 122018" });
  await expect(panel).toContainText("This messages 2 people");
  await expect(panel.getByLabel("Launch date")).toHaveCount(0);
  await expect(panel).toContainText("Nobody who has been told is told again.");
  await panel.getByRole("button", { name: "Send to 2" }).click();
  await expect(panel.getByRole("status")).toHaveText("Launched. 2 on their way.");
});

test("offers nothing to send where everyone in a live pincode has been told", async ({ page }) => {
  const told = { pincode: "122018", waiting: 4, alerts: 0, launched: false };
  await open(page, { [LAUNCH_SECTOR_65]: launchRoute(told, told) });
  await page.getByRole("button", { name: "Tell those waiting in 122018, Sector 65" }).click();
  const panel = page.getByRole("region", { name: "Tell those waiting in 122018" });
  await expect(panel).toContainText("This messages nobody");
  await expect(panel.getByRole("button", { name: /^Send|^Mark/ })).toHaveCount(0);
});

// OPS-13: the message named the area by its post office, with no way to a better name.
test("says where the message's name for the area comes from, and leads there", async ({ page }) => {
  await open(page, { [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByRole("link", { name: "Change the name" }).click();
  await expect(page).toHaveURL(/\/settings\/area$/);
});
