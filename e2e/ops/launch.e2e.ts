// Marking a pincode live from Areas' Waiting tab, telling those who wait in one
// already live, and adding one the service area does not hold first (board C3;
// docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// e2e/ops/waitlist.e2e.ts holds the queue itself; this holds the panel.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  ADDED,
  answer,
  AREAS,
  fails,
  json,
  LAUNCHED,
  PREVIEW,
  UNHELD,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

const BANDRA = "/api/pincodes/400050/launch";
const SECTOR_65 = "/api/pincodes/122018/launch";
const LAUNCH_BANDRA: Call = `POST ${BANDRA}`;
const LAUNCH_SECTOR_65: Call = `POST ${SECTOR_65}`;
const MG_ROAD = "/api/pincodes/560001/launch";
const LAUNCH_MG_ROAD: Call = `POST ${MG_ROAD}`;

/** Answers a launch route with `preview` while confirm is false, and `launched` once it is true. */
const launchRoute = (preview: object, launched: object) => (route: Route) => {
  const body = route.request().postDataJSON() as { confirm: boolean };
  return json(body.confirm ? launched : preview)(route);
};

async function open(page: Page, routes: Answers, areas: OpsReply<"/api/waitlist"> = AREAS) {
  await answer(page, { "GET /api/waitlist": json(areas), ...routes });
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
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
test("takes the day a technician started coming, and sends it only when ops chose one", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-02-10T06:00:00.000Z"));
  await open(page, { [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await panel.getByLabel("Launch date").fill("2027-02-01");

  // The preview was the first call; the next is the launch.
  const sent = page.waitForRequest((request) => request.url().endsWith(BANDRA) && request.method() === "POST");
  await panel.getByRole("button", { name: "Send to 84" }).click();
  expect((await sent).postDataJSON()).toEqual({ confirm: true, launch_on: "2027-02-01" });
});

// BK-38 of the audit, 2 October 2026: a launch dated to a later day served the pincode at once, and its alerts went.
test("sends no launch dated to a day still to come", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-02-10T06:00:00.000Z"));
  await open(page, { [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await panel.getByLabel("Launch date").fill("2027-02-20");
  await expect(panel.getByRole("button", { name: "Send to 84" })).toBeDisabled();
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
  await expect(page).toHaveURL(/\/areas\/served$/);
});

// A launch keeps to the caller's cities, while the service area is set nationally: Growth Manage in one city is not led
// to a page it cannot change.
test("leads to the area's name only those whose access reaches Service area", async ({ page }) => {
  const growthInMumbai = json({
    signed_in_as: "growth@maneman.in",
    sign_out: "/cdn-cgi/access/logout",
    staff: {
      enforced: true,
      listed: true,
      grants: [{ department: "growth", level: "manage", geography: "city", place: "Mumbai" }],
      may_call: ["GET /api/health", "GET /api/whoami", "GET /api/waitlist", "POST /api/pincodes/{pin}/launch"],
    },
  });
  await open(page, { "GET /api/whoami": growthInMumbai, [LAUNCH_BANDRA]: launchRoute(PREVIEW, LAUNCHED) });
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel).toContainText("The message names the area as Served names it");
  await expect(panel.getByRole("link", { name: "Change the name" })).toHaveCount(0);
});

// BK-36 and OIA-13 of the audit, 2 October 2026: every pincode on staging's waitlist was outside the service area, so
// "Mark live" answered "We have no such pincode", and no screen could add one.
test("adds a pincode the service area does not hold, then marks it live in the same panel", async ({ page }) => {
  const preview = { pincode: "560001", waiting: 3, alerts: 2, launched: false };
  await open(
    page,
    {
      "POST /api/pincodes": json(ADDED, 201),
      [LAUNCH_MG_ROAD]: launchRoute(preview, { ...preview, launched: true }),
    },
    { ...AREAS, areas: [...AREAS.areas, UNHELD] },
  );
  const row = page.getByRole("row").filter({ hasText: "560001" });
  await expect(row).toContainText("Not in the service area");
  await row.getByRole("button", { name: "Add 560001, then mark it live" }).click();

  const adding = page.getByRole("region", { name: "Add 560001" });
  await expect(adding).toBeFocused();
  await adding.getByLabel("Area, as messages name it").fill("MG Road");
  await adding.getByLabel("City").selectOption("Bengaluru");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/pincodes") && request.method() === "POST");
  await adding.getByRole("button", { name: "Add it" }).click();
  expect((await sent).postDataJSON()).toEqual({ pincode: "560001", area: "MG Road", city: "Bengaluru" });

  const panel = page.getByRole("region", { name: "Mark 560001 live" });
  await expect(panel).toContainText("This messages 2 people");
  await expect(panel).toContainText("Mane Man now comes to MG Road");
  await panel.getByRole("button", { name: "Send to 2" }).click();
  await expect(panel.getByRole("status")).toHaveText("Launched. 2 on their way.");
});

test("says so when the pincode is held already, and adds nothing", async ({ page }) => {
  await open(page, { "POST /api/pincodes": fails(409, "pincode_held") }, { ...AREAS, areas: [...AREAS.areas, UNHELD] });
  await page.getByRole("button", { name: "Add 560001, then mark it live" }).click();
  const adding = page.getByRole("region", { name: "Add 560001" });
  await adding.getByLabel("Area, as messages name it").fill("MG Road");
  await adding.getByLabel("City").selectOption("Bengaluru");
  await adding.getByRole("button", { name: "Add it" }).click();
  await expect(adding.getByRole("alert")).toHaveText("We hold that pincode already.");
  await expect(page.getByRole("region", { name: "Mark 560001 live" })).toHaveCount(0);
});

test("offers no way to add a pincode to one whose access does not reach it, and says why there is none", async ({
  page,
}) => {
  const viewer = json({
    signed_in_as: "growth@maneman.in",
    sign_out: "/cdn-cgi/access/logout",
    staff: {
      enforced: true,
      listed: true,
      grants: [{ department: "growth", level: "view", geography: "national", place: null }],
      may_call: ["GET /api/health", "GET /api/whoami", "GET /api/waitlist", "GET /api/service-area"],
    },
  });
  await open(page, { "GET /api/whoami": viewer }, { ...AREAS, areas: [...AREAS.areas, UNHELD] });
  const row = page.getByRole("row").filter({ hasText: "560001" });
  await expect(row).toContainText("Not in the service area");
  await expect(row.getByRole("button")).toHaveCount(0);
});
