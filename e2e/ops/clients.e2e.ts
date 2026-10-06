// One client's page: finding them by part of their name or
// number, the ways to reach them, what waits on Tasks for them, their visits,
// pieces, payments and invite, their photographs, which are opened as one logged
// view, and their consents, which ops read and never change. The API is answered from e2e/ops/fixtures.ts,
// since no route seeds a client's pieces or photographs.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  CLIENT,
  fails,
  json,
  NEW_RECORD,
  NO_HAIR_PROFILE,
  PIECES,
  RECORD,
  TASKS_READ_ON,
  type OpsReply,
} from "./fixtures.ts";
import {
  READ_RECORD,
  READ_PIECES,
  READ_HAIR_PROFILE,
  FIND,
  NAME,
  FOUND,
  openClient,
  meta,
  clientTab,
  invitedBy,
} from "./clients-fixtures.ts";

const MOBILE = "+91 98100 04417";

const STANDING = "Fitted · Next visit Sat 25 Sep, 10:30 am";

/** What waits on Tasks for Rohit: a replacement to order, three days overdue, and a number change, due tomorrow. */
const OPEN_FOR_ROHIT = {
  overdue: 1,
  truncated: false,
  low_stock_places: 0,
  staff: [],
  groups: [
    {
      group: "replacement_order",
      count: 1,
      closable: false,
      tasks: [
        {
          id: "91000000-0000-4000-8000-000000000002",
          person: { id: CLIENT.id, name: CLIENT.name },
          detail: "MM-STD-4417-C 2027-09-22",
          since: "2027-09-16T18:30:00.000Z",
          due: "2027-09-18T18:30:00.000Z",
          owner: null,
        },
      ],
    },
    {
      group: "number_change",
      count: 1,
      closable: false,
      tasks: [
        {
          id: "94000000-0000-4000-8000-000000000009",
          person: { id: CLIENT.id, name: CLIENT.name },
          detail: null,
          since: "2027-09-21T06:00:00.000Z",
          due: "2027-09-23T06:00:00.000Z",
          owner: null,
        },
      ],
    },
  ],
} satisfies OpsReply<"/api/tasks">;

const openForClient = (page: Page) => page.getByRole("region", { name: "Open for this client" });

// A client could be found only by their whole number, typed exactly.
test("finds clients by part of a name, and sends it in the body, never in the URL", async ({ page }) => {
  await answer(page, {
    [FIND]: json({ clients: [FOUND], more: false }),
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_HAIR_PROFILE]: json(NO_HAIR_PROFILE),
  });
  await page.goto("/clients");

  const sent = page.waitForRequest((request) => request.url().includes("/clients/find"));
  await page.getByLabel("Name or number").fill("malhotra");
  await page.getByRole("button", { name: "Find" }).click();

  const request = await sent;
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual({ text: "malhotra" });
  expect(new URL(request.url()).search).toBe("");

  const found = page.getByRole("region", { name: "Clients" });
  await expect(found.getByRole("listitem")).toHaveText([`${CLIENT.name}${STANDING}${MOBILE}`]);
  await found.getByRole("link", NAME).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/clients/${CLIENT.id}/visits`);
});

// Search lived on Clients alone, Back lost the results, and a result named no state or visit.
test("finds a client from another page's header, keeps the words out of the URL, and keeps the results across Back", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/clients/find")) asked.push((request.postDataJSON() as { text: string }).text);
  });
  await answer(page, {
    [FIND]: json({ clients: [FOUND], more: false }),
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_HAIR_PROFILE]: json(NO_HAIR_PROFILE),
  });
  await page.goto(`/clients/${CLIENT.id}/visits`);
  await page.getByRole("searchbox", { name: "Find a client by name or number" }).fill("98100 0441");
  await page.getByRole("button", { name: "Find client" }).click();

  const found = page.getByRole("region", { name: "Clients" });
  await expect(found.getByRole("listitem")).toHaveText([`${CLIENT.name}${STANDING}${MOBILE}`]);
  expect(new URL(page.url()).pathname).toBe("/clients");
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByLabel("Name or number")).toHaveValue("98100 0441");

  await found.getByRole("link", NAME).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  await page.goBack();
  await expect(found.getByRole("listitem")).toHaveText([`${CLIENT.name}${STANDING}${MOBILE}`]);
  expect(asked).toEqual(["98100 0441"]);
});

test("offers the clients opened this session, and forgets them on sign-out", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": json({
      signed_in_as: "ops@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      staff: {
        enforced: false,
        listed: true,
        grants: [],
        may_call: ["GET /api/clients/{id}", "POST /api/clients/find", "GET /api/clients/{id}/hair-profile"],
      },
    }),
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_HAIR_PROFILE]: json(NO_HAIR_PROFILE),
  });
  await page.goto(`/clients/${CLIENT.id}/visits`);
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  await page.goto("/clients");
  const recent = page.getByRole("region", { name: "Opened this session" });
  await expect(recent.getByRole("link", NAME)).toHaveAttribute("href", `/clients/${CLIENT.id}/visits`);

  await page.route("**/cdn-cgi/access/logout", (route) => route.fulfill({ contentType: "text/html", body: "" }));
  await page.getByRole("link", { name: "Sign out" }).click();
  await page.waitForURL("**/cdn-cgi/access/logout");
  expect(await page.evaluate(() => sessionStorage.getItem("ops.recent-clients"))).toBeNull();
});

test("says so when nobody matches, and when more match than are listed", async ({ page }) => {
  await answer(page, { [FIND]: json({ clients: [], more: false }) });
  await page.goto("/clients");
  await page.getByLabel("Name or number").fill("98100 0441");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("status")).toContainText("Nobody matches “98100 0441”.");

  await answer(page, { [FIND]: json({ clients: [FOUND], more: true }) });
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("More clients match than are listed.")).toBeVisible();
});

test("asks for two letters or four digits when given fewer", async ({ page }) => {
  await answer(page, { [FIND]: fails(400, "invalid_request") });
  await page.goto("/clients");
  await page.getByLabel("Name or number").fill("r");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("alert")).toContainText("Type two letters of a name, or four digits of a number.");
});

test("heads the page with the client's standing and the number to reach them on", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  // "Fitted" heads a column of the pieces table beneath, so the standing is read from its own list.
  // The replacement is the month the board's head writes, never the day the pieces table carries.
  await expect(meta(page)).toHaveText(["Fitted", "2 · use by 3 Jan 2028", "Mar 2028", MOBILE, "Vikram Sethi (VSAB23)"]);
  await expect(page.getByRole("link", { name: `Call ${CLIENT.name} on ${MOBILE}` })).toHaveAttribute(
    "href",
    `tel:${CLIENT.mobile}`,
  );
});

// Who invited a client was shown only under Payments, below the credits form.
test("heads the page with who invited the client, a way to their page, and the invite's code", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(invitedBy(page)).toHaveText("Vikram Sethi (VSAB23)");
  await expect(invitedBy(page).getByRole("link", { name: "Vikram Sethi" })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000009/visits",
  );
});

// A client's page showed nothing open for them while a task about them waited.
test("lists what waits on Tasks for the client under the head, each with a way to where it is done", async ({
  page,
}) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  const asked = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/tasks" && url.searchParams.get("person") === CLIENT.id;
  });
  await openClient(page, `/clients/${CLIENT.id}`, { "GET /api/tasks": json(OPEN_FOR_ROHIT) });
  await asked;

  const rows = openForClient(page).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Replacement order3 days overdue");
  await expect(rows.nth(1)).toContainText("Number change1 day left");
  await expect(openForClient(page).getByRole("link", { name: "Go to Hair · Replacement order" })).toHaveAttribute(
    "href",
    `/clients/${CLIENT.id}/pieces`,
  );
  await expect(
    openForClient(page).getByRole("link", { name: "Decide it in Number changes · Number change" }),
  ).toHaveAttribute("href", "/number-changes#change-94000000-0000-4000-8000-000000000009");
  expect(await axeViolations(page)).toEqual([]);
});

test("says when nothing waits on Tasks for the client", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, {
    "GET /api/tasks": json({ overdue: 0, truncated: false, low_stock_places: 0, staff: [], groups: [] }),
  });
  await expect(openForClient(page)).toContainText("Nothing open.");
});

// The design draws WhatsApp beside the name; the page once gave no way to reach the client.
test("opens a WhatsApp chat with the client from beside their name, as the board draws it", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("link", { name: `WhatsApp ${CLIENT.name}` })).toHaveAttribute(
    "href",
    "https://wa.me/919810004417",
  );
});

test("says in words that a client wearing no piece falls due on no date", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(meta(page)).toHaveText(["Booked", "2 · use by 3 Jan 2028", "No piece fitted", MOBILE]);
});

// The page opened on an empty Pieces tab, a click away from the visit.
test("opens on the visits, with the invite on a Referrals tab of its own", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("navigation", { name: CLIENT.name }).getByRole("link")).toHaveText([
    "Visits",
    "Hair",
    "Payments",
    "Referrals",
    "Consents",
    "Photos",
    "Overview",
  ]);
  await expect(clientTab(page, "Visits")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
});

test("lists the pieces in the board's columns", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/pieces`);
  const piece = page.getByRole("row").filter({ hasText: "MM-STD-4417-B" });
  await expect(piece).toContainText("Mono");
  await expect(piece).toContainText("14 Nov 2026");
  await expect(piece).toContainText("L-1109");
  await expect(piece).toContainText("1 Jun 2027");
  await expect(piece).toContainText("24 Jun 2027 · base split at crown");
});

test("writes a gap where a piece has no supplier lot, replacement date or failure", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/pieces`);
  const live = page.getByRole("row").filter({ hasText: "MM-STD-4417-C" });
  // The piece still in wear has no failure; the one rejected at the fit has no lot and no replacement due.
  await expect(live).toContainText("—");
  await expect(page.getByRole("row").filter({ hasText: "MM-STD-4417-A" })).toContainText("—");
});

test("says so when the client has no piece yet", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_PIECES]: json({ pieces: [] }) });
  await expect(page.getByText("No piece has been fitted for this client.")).toBeVisible();
});
