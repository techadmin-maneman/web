// One client's page (boards B1 to B3): finding them by part of their name or
// number, the ways to reach them, what waits on Tasks for them, their visits,
// pieces, payments and invite, their photographs, which are opened as one logged
// view, and their consents, which ops read and never change. The API is answered from e2e/ops/fixtures.ts,
// since no route seeds a client's pieces or photographs.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  CLIENT,
  CONSENTS,
  empty,
  ERASURE_REQUESTED,
  fails,
  HAIR_PROFILE,
  inkPhoto,
  jpeg,
  json,
  NEW_RECORD,
  NO_HAIR_PROFILE,
  PHOTOS,
  PIECES,
  RECORD,
  TASKS_READ_ON,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RECORD_PATH = `/api/clients/${CLIENT.id}` as const;
const READ_RECORD: Call = `GET ${RECORD_PATH}`;
const READ_PIECES: Call = `GET ${RECORD_PATH}/pieces`;
const READ_PHOTOS: Call = `GET ${RECORD_PATH}/photos`;
const VIEW_PHOTOS: Call = `POST ${RECORD_PATH}/photos/view`;
const READ_CONSENTS: Call = `GET ${RECORD_PATH}/consents`;
const READ_HAIR_PROFILE: Call = `GET ${RECORD_PATH}/hair-profile`;
const CORRECT_HAIR_PROFILE: Call = `POST ${RECORD_PATH}/hair-profile`;
const ADD_CREDITS: Call = `POST ${RECORD_PATH}/credits`;
const ATTACH_INVITE: Call = `POST ${RECORD_PATH}/referral`;
const SUGGEST: Call = `POST ${RECORD_PATH}/address/suggestions`;
const SAVE_ADDRESS: Call = `POST ${RECORD_PATH}/address`;
const ERASE: Call = `POST ${RECORD_PATH}/erasure`;
const FIND: Call = "POST /api/clients/find";
const readPhoto = (id: string): Call => `GET ${RECORD_PATH}/photos/${id}`;
const NAME = { name: CLIENT.name, exact: true };
const MOBILE = "+91 98100 04417";
type ConsentSource = OpsReply<"/api/clients/{id}/consents">["consents"][number]["source"];

/** The opening the API logs, at India's 10:42 by its own clock, and one before it. */
const VIEW = {
  logged_at: "2027-09-22T05:12:00.000Z",
  before: [{ by: "ops@maneman.in", at: "2027-09-19T04:40:00.000Z" }],
} satisfies OpsReply<"/api/clients/{id}/photos/view", "post">;

/** What an erasure from the client's page answers: what went. */
const ERASED = {
  erased_at: "2027-09-22T05:12:00.000Z",
  photos_deleted: 1,
  results_deleted: 1,
  visit_photos_deleted: 10,
  messages_cancelled: 0,
  sessions_ended: 1,
  addresses_removed: 1,
} satisfies OpsReply<"/api/clients/{id}/erasure", "post">;

/** Nothing erased: a visit of theirs is still booked. */
const VISIT_BOOKED = {
  error: { code: "visit_booked", request_id: "test" },
  visits: [
    {
      id: "77000000-0000-4000-8000-000000000001",
      type: "service",
      status: "scheduled",
      window_start: "2027-09-27T04:30:00.000Z",
    },
  ],
  bookings: [],
  payments: [],
  links: [],
} satisfies OpsReply<"/api/clients/{id}/erasure", "post", 409>;

/** The client's routes, with every photograph a block of ink; `over` replaces any of them. */
async function clientRoutes(page: Page, over: Answers = {}): Promise<void> {
  await answer(page, {
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_PHOTOS]: json(PHOTOS),
    [VIEW_PHOTOS]: json(VIEW),
    [READ_CONSENTS]: json(CONSENTS),
    [READ_HAIR_PROFILE]: json(NO_HAIR_PROFILE),
    "GET /api/clients/{id}/photos/{photo_id}": jpeg(await inkPhoto()),
    ...over,
  });
}

async function openClient(page: Page, path: string, over: Answers = {}): Promise<void> {
  await clientRoutes(page, over);
  await page.goto(path);
}

/** The head's figures, by the name the board letters each with. */
const meta = (page: Page) => page.getByRole("definition");

/** One of the client's tabs, apart from the navigation's section of the same name. */
const clientTab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: CLIENT.name }).getByRole("link", { name, exact: true });

/** Who invited the client, in the head. */
const invitedBy = (page: Page) =>
  page
    .getByRole("term")
    .filter({ hasText: /^Invited by$/ })
    .locator("+ dd");

// A client could be found only by their whole number, typed exactly (OPS-04).
test("finds clients by part of a name, and sends it in the body, never in the URL", async ({ page }) => {
  await answer(page, {
    [FIND]: json({ clients: [CLIENT], more: false }),
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
  await expect(found.getByRole("listitem")).toHaveText([`${CLIENT.name}${MOBILE}`]);
  await found.getByRole("link", NAME).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/clients/${CLIENT.id}/visits`);
});

test("says so when nobody matches, and when more match than are listed", async ({ page }) => {
  await answer(page, { [FIND]: json({ clients: [], more: false }) });
  await page.goto("/clients");
  await page.getByLabel("Name or number").fill("98100 0441");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("status")).toContainText("Nobody matches “98100 0441”.");

  await answer(page, { [FIND]: json({ clients: [CLIENT], more: true }) });
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

// Who invited a client was shown only under Payments, below the credits form (MON-16).
test("heads the page with who invited the client, a way to their page, and the invite's code", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(invitedBy(page)).toHaveText("Vikram Sethi (VSAB23)");
  await expect(invitedBy(page).getByRole("link", { name: "Vikram Sethi" })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000009/visits",
  );
});

/** What waits on Tasks for Rohit: a replacement to order, three days overdue, and a number change, due tomorrow. */
const OPEN_FOR_ROHIT = {
  overdue: 1,
  truncated: false,
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
          detail: "MM-STD-4417-C",
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

// OIA-10 of the audit, 2 October 2026: a client's page showed nothing open for them while a task about them waited.
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
  await expect(openForClient(page).getByRole("link", { name: "Go to Pieces · Replacement order" })).toHaveAttribute(
    "href",
    `/clients/${CLIENT.id}/pieces`,
  );
  await expect(
    openForClient(page).getByRole("link", { name: "Decide it in Number changes · Number change" }),
  ).toHaveAttribute("href", "/number-changes#change-94000000-0000-4000-8000-000000000009");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("says when nothing waits on Tasks for the client", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, {
    "GET /api/tasks": json({ overdue: 0, truncated: false, staff: [], groups: [] }),
  });
  await expect(openForClient(page)).toContainText("Nothing open.");
});

// Board B1 draws WhatsApp beside the name; the page once gave no way to reach the client (OPS-05).
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

// OIA-10 of the audit, 2 October 2026: the page opened on an empty Pieces tab, a click away from the visit.
test("opens on the visits, with the invite on a Referrals tab of its own", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("navigation", { name: CLIENT.name }).getByRole("link")).toHaveText([
    "Visits",
    "Pieces",
    "Payments",
    "Referrals",
    "Consents",
    "Photos",
    "History",
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

test("writes a gap where FSM's asset has no supplier lot, replacement date or failure", async ({ page }) => {
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

// The client's hair profile, which no board draws, above the pieces (docs/decisions/0106-a-clients-hair-profile.md).
test.describe("the client's hair profile", () => {
  const section = (page: Page) => page.getByRole("region", { name: "Hair profile" });

  test("stands above the pieces: the latest, its history, and every version with who recorded it", async ({ page }) => {
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_HAIR_PROFILE]: json(HAIR_PROFILE) });
    const profile = section(page);
    await expect(profile.getByRole("definition").first()).toHaveText("IV");
    await expect(profile.locator("dl").first()).toContainText("Colour#2");
    await expect(profile.locator("dl").first()).toContainText("Skin conditions and allergiesDry at the crown");
    await expect(profile.getByRole("listitem")).toHaveText([
      /^22 Sep 2027 · ops@maneman\.in, a correction/,
      /^21 Sep 2027 · Imran, at the consultation/,
    ]);
    await expect(page.getByRole("row").filter({ hasText: "MM-STD-4417-B" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
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
    await section(page).getByRole("button", { name: "Correct the profile" }).click();
    const colour = page.getByRole("combobox", { name: "Colour" });
    await expect(colour).toHaveValue("2");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await colour.selectOption({ label: "#3" });
    const sent = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/hair-profile"),
    );
    await page.getByRole("button", { name: "Save as a new version" }).click();
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
    await section(page).getByRole("button", { name: "Correct the profile" }).click();
    await page.getByRole("button", { name: "Save as a new version" }).click();

    await expect(section(page).getByRole("alert")).toContainText("Nothing was saved: the profile changed");
    await expect(section(page).locator("dl").first()).toContainText("Colour#4");
  });

  test("sends nothing while a figure is no number at all, and marks it", async ({ page }) => {
    let sent = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/hair-profile")) sent += 1;
    });
    await openClient(page, `/clients/${CLIENT.id}/pieces`, { [READ_HAIR_PROFILE]: json(HAIR_PROFILE) });
    await section(page).getByRole("button", { name: "Correct the profile" }).click();
    await page.getByRole("textbox", { name: "Grey, %" }).fill("twenty");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await expect(page.getByRole("textbox", { name: "Grey, %" })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toHaveText("Some fields were not accepted. Check the fields marked.");
    expect(sent).toBe(0);
  });

  test("marks the field the API refused", async ({ page }) => {
    await openClient(page, `/clients/${CLIENT.id}/pieces`, {
      [READ_HAIR_PROFILE]: json(HAIR_PROFILE),
      [CORRECT_HAIR_PROFILE]: fails(400, "invalid_request", ["fit.base_width_in"]),
    });
    await section(page).getByRole("button", { name: "Correct the profile" }).click();
    await page.getByRole("textbox", { name: "Base width, in" }).fill("80");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await expect(page.getByRole("alert")).toHaveText("Some fields were not accepted. Check the fields marked.");
    await expect(page.getByRole("textbox", { name: "Base width, in" })).toHaveAttribute("aria-invalid", "true");
  });
});

// The record carried the address, the access notes and every visit, and the page showed none of them (OPS-04).
test("lists where visits go, and every visit to come and done", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`);
  await expect(page.getByText("House 1204, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();

  const coming = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await expect(coming).toContainText("25 Sep 2027");
  await expect(coming).toContainText("9 am to 10:30 am");
  await expect(coming).toContainText("Service visit");
  await expect(coming).toContainText("Imran Qureshi");
  await expect(coming).toContainText("Booked · Prepaid");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("row").nth(1)).toContainText("22 Aug 2027");
  // OIA-03, BK-21: a visit to come opens on the dispatch board, on its week with its drawer open; a visit done does not.
  await expect(coming.getByRole("link", { name: "Show on board: the visit of 25 Sep 2027" })).toHaveAttribute(
    "href",
    "/dispatch?from=2027-09-25&visit=33000000-0000-4000-8000-000000000002",
  );
  await expect(page.getByRole("region", { name: "Done" }).getByRole("link", { name: /Show on board/ })).toHaveCount(0);
});

test("says so when there is no address and no visit either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(page.getByText("No address saved yet.")).toBeVisible();
  await expect(page.getByText("Nothing booked.")).toBeVisible();
  await expect(page.getByText("No visit done yet.")).toBeVisible();
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
  await page.getByRole("button", { name: "Record an address they give you" }).click();
  const form = page.getByRole("form", { name: "An address the client gave you" });
  await form.getByRole("combobox", { name: "Search for their building" }).fill("Sunrise");
  await form.getByRole("option", { name: /Sunrise Greens/ }).click();
  await form.getByLabel("Flat or house number").fill("Flat 1203");
  await form.getByLabel("Tower or block (optional)").fill("Tower C");
  await form.getByLabel("Sector or area").fill("Sector 65");
  await form.getByLabel("City").fill("Gurgaon");
  await form.getByLabel("Pincode").fill("122018");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await form.getByRole("button", { name: "Save their address" }).click();

  await expect(page.getByText("Flat 1203, Tower C, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("To ops@localhost, 22 Sep 2027")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved as their address, marked as given to you.");
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
  await page.getByRole("button", { name: "Record an address they give you" }).click();
  const form = page.getByRole("form", { name: "An address the client gave you" });
  await form.getByRole("button", { name: "Save their address" }).click();
  await expect(form.getByRole("alert")).toContainText("Fill in the flat or house number, the building or street");
  await expect(form.getByLabel("Flat or house number")).toBeFocused();
  await expect(form.getByLabel("Flat or house number")).toHaveAttribute("required", "");
  expect(sent).toBe(0);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Record an address they give you" })).toBeFocused();
});

// A discount code on a visit not yet paid for or invoiced (docs/decisions/0108-discount-codes.md), which no board draws.
test("enters a discount code on a visit not yet paid for, says when one does not apply, and takes it off", async ({
  page,
}) => {
  const [coming] = RECORD.visits.upcoming;
  if (coming === undefined) throw new Error("the record has no visit to come");
  const open = {
    ...RECORD,
    visits: { ...RECORD.visits, upcoming: [{ ...coming, prepaid: false, price_open: true }] },
  } satisfies OpsReply<"/api/clients/{id}">;
  const entered = `POST /api/visits/${coming.id}/discount-code` as const;
  const removed = `POST /api/visits/${coming.id}/discount-code/remove` as const;
  let applies = false;
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    [READ_RECORD]: json(open),
    [entered]: (route) =>
      applies
        ? json({ code: "WEDDNG25", amount_off: 50_000, given_by: "ops" })(route)
        : fails(422, "code_not_applicable")(route),
    [removed]: empty(),
  });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" }).click();
  await row.getByLabel("Discount code").fill("wrong1");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(row.getByRole("alert")).toHaveText("That code does not apply to this visit.");

  applies = true;
  await row.getByLabel("Discount code").fill("weddng25");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(row).toContainText("WEDDNG25, Rs. 500 off");
  await expect(row).toContainText("by ops");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await row.getByRole("button", { name: "Take the discount code off the visit of 25 Sep 2027" }).click();
  await expect(row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" })).toBeVisible();
});

// MON-23: once the one visit was booked, ops no longer saw the code the client gave when booking on the site.
test("shows the code the client gave when booking, and starts the box from it", async ({ page }) => {
  const [coming] = RECORD.visits.upcoming;
  if (coming === undefined) throw new Error("the record has no visit to come");
  const asked = {
    ...RECORD,
    visits: {
      ...RECORD.visits,
      upcoming: [{ ...coming, type: "first_fit" as const, prepaid: false, price_open: true, requested_code: "TENPC" }],
    },
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(asked) });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await expect(row).toContainText("Client gave TENPC when booking");
  await row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" }).click();
  await expect(row.getByLabel("Discount code")).toHaveValue("TENPC");
});

test("offers no code on a visit already paid for", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(RECORD) });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await expect(row).toContainText("None");
  await expect(row.getByRole("button", { name: /discount code/ })).toHaveCount(0);
});

// A visit left partly done that ops closed without a follow-up, from the Tasks board (ADR 0092).
test("says who closed a visit left partly done without a follow-up, when and why", async ({ page }) => {
  const [done] = RECORD.visits.past;
  if (done === undefined) throw new Error("the record has no visit done");
  const closed = {
    ...RECORD,
    visits: {
      ...RECORD.visits,
      past: [
        {
          ...done,
          outcome: "partial" as const,
          closed_without_follow_up: {
            by: "priya@maneman.in",
            at: "2027-09-01T06:00:00.000Z",
            reason: "Moving to Pune; wants no more visits.",
          },
        },
      ],
    },
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(closed) });
  await expect(page.getByRole("region", { name: "Done" }).getByRole("row").nth(1)).toContainText(
    "Closed without a follow-up by priya@maneman.in, 1 Sep 2027: Moving to Pune; wants no more visits.",
  );
});

test("lists what the client has paid, and what for", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("20 Aug 2027");
  await expect(payment).toContainText("Service visit of 22 Aug 2027");
  await expect(payment).toContainText("Rs. 2,360");
  await expect(payment).toContainText("Paid · Ref MM-2027-0841");
});

test("names the discount code a payment was made with, and what it took off", async ({ page }) => {
  const [paid] = RECORD.payments;
  const withCode = {
    ...RECORD,
    payments: paid === undefined ? [] : [{ ...paid, discount_code: { code: "AUDTEST", amount_off: 100_000 } }],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(withCode) });
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("Code AUDTEST, Rs. 1,000 off");
});

// A booking paid for and not yet a visit read as a bare "Payment" (P2-25's note).
test("names a payment for a booking not yet a visit by what is being booked", async ({ page }) => {
  const [paid] = RECORD.payments;
  const forBooking = {
    ...RECORD,
    payments:
      paid === undefined
        ? []
        : [{ ...paid, visit: null, booking: { type: "first_fit", date: "2027-10-04", under_way: true } }],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(forBooking) });
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("First fit of 4 Oct 2027");
});

// MON-16 and OIA-08: a client who lost Razorpay's text could not be sent the link again; the address sat only in D1.
test("lists the payment links sent, and copies an open one's address to send again", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const links = page.getByRole("region", { name: "Payment links" });
  const open = links.getByRole("row").nth(1);
  await expect(open).toContainText("21 Sep 2027");
  await expect(open).toContainText("Service visit, visit of 2 Oct 2027");
  await expect(open).toContainText("Rs. 2,360");
  await expect(open).toContainText("Waiting to be paid · Ref MM-2027-0902");
  await expect(open).toContainText("https://rzp.io/i/MMsv902");

  const copy = open.getByRole("button");
  await expect(copy).toHaveAccessibleName("Copy link · Service visit, visit of 2 Oct 2027");
  await copy.click();
  await expect(copy).toHaveAccessibleName("Copied · Service visit, visit of 2 Oct 2027");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://rzp.io/i/MMsv902");

  const paidLink = links.getByRole("row").nth(2);
  await expect(paidLink).toContainText("Paid 20 Aug 2027 · Ref MM-2027-0841");
  await expect(paidLink.getByRole("button")).toHaveCount(0);
});

test("says where each finished visit's invoice stands in Books", async ({ page }) => {
  const withDraft = {
    ...RECORD,
    invoices: [
      {
        visit_id: "33000000-0000-4000-8000-000000000003",
        date: "2027-09-01",
        type: "replacement",
        state: "draft",
        issued_at: null,
      },
      ...RECORD.invoices,
    ],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(withDraft) });
  const invoices = page.getByRole("region", { name: "Invoices" }).getByRole("row");
  await expect(invoices.nth(1)).toContainText("Replacement of 1 Sep 2027");
  await expect(invoices.nth(1)).toContainText("Draft in Books, not sent");
  await expect(invoices.nth(2)).toContainText("Service visit of 22 Aug 2027");
  await expect(invoices.nth(2)).toContainText("Sent 22 Aug 2027");
});

test("says so when nothing was linked or invoiced yet", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(page.getByRole("region", { name: "Payment links" })).toContainText("No payment links yet.");
  await expect(page.getByRole("region", { name: "Invoices" })).toContainText("No finished visit to invoice yet.");
});

// A credit given or taken in error once needed SQL to put right (BIZ-15).
test("puts a client's credits right, with the reason, and shows the balance it answers", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
    [ADD_CREDITS]: json({ visits: 1, earliest_expiry: "2028-01-03T06:00:00.000Z" }),
  });
  const credits = page.getByRole("region", { name: "Free service visits" });
  await expect(credits).toContainText("2 visits · use by 3 Jan 2028");
  const save = credits.getByRole("button", { name: "Put the credits right" });
  await expect(save).toBeDisabled();

  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-1");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  const sent = page.waitForRequest((request) => request.url().endsWith("/credits") && request.method() === "POST");
  await save.click();
  expect((await sent).postDataJSON()).toEqual({ visits: -1, reason: "correction" });

  await expect(credits.getByRole("status")).toHaveText("Done. They now hold 1 visit.");
  // The head reads the balance the API answered, without the record being read again.
  await expect(meta(page).nth(1)).toHaveText("1 · use by 3 Jan 2028");
});

test("offers no change of nought, or of more than twelve visits either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const credits = page.getByRole("region", { name: "Free service visits" });
  await credits.getByRole("radio", { name: "Goodwill: to make up for something" }).check();
  const field = credits.getByLabel("Visits to add, or to take away with a minus");
  const save = credits.getByRole("button", { name: "Put the credits right" });
  for (const typed of ["0", "13", "-13", "two"]) {
    await field.fill(typed);
    await expect(save, typed).toBeDisabled();
  }
  await field.fill("12");
  await expect(save).toBeEnabled();
});

test("says so when the API would take away more than the client holds", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
    [ADD_CREDITS]: fails(400, "invalid_request"),
  });
  const credits = page.getByRole("region", { name: "Free service visits" });
  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-5");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  await credits.getByRole("button", { name: "Put the credits right" }).click();
  await expect(credits.getByRole("alert")).toContainText("That would take away more visits than they hold");
});

// A friend who booked away from the invite's page earned their referrer nothing until ops could attach it (ADR 0089).
test("says where the visits of the invite a client came with stand", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/referrals`);
  const invite = page.getByRole("region", { name: "Invite" });
  await expect(invite).toContainText("What it earnsGiven");
  await expect(invite).toContainText("Since20 Oct 2026");
  await expect(invite.getByText("Attached by")).toHaveCount(0);
  await expect(invite.getByRole("button", { name: "Attach the invite" })).toHaveCount(0);
});

test("attaches an invite to a client who came with none, with why, and shows it as the API answers", async ({
  page,
}) => {
  const attached = {
    code: "RM4K7P",
    referrer: { id: "22000000-0000-4000-8000-000000000008", name: "Rohit Malhotra" },
    grant: "pending",
    since: "2027-09-22T05:12:00.000Z",
    attached: { by: "ops@maneman.in", reason: "Told us Rohit sent him" },
  } satisfies OpsReply<"/api/clients/{id}/referral", "post", 201>;
  await openClient(page, `/clients/${CLIENT.id}/referrals`, {
    [READ_RECORD]: json(NEW_RECORD),
    [ATTACH_INVITE]: json(attached, 201),
  });
  const invite = page.getByRole("region", { name: "Invite" });
  await expect(invite).toContainText("They came with no invite.");
  const attach = invite.getByRole("button", { name: "Attach the invite" });
  await expect(attach).toBeDisabled();

  await invite.getByLabel("Invite code").fill("rm4k7p");
  await expect(attach).toBeDisabled();
  await invite.getByLabel("Why").fill("Told us Rohit sent him");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  const sent = page.waitForRequest((request) => request.url().endsWith("/referral") && request.method() === "POST");
  await attach.click();
  expect((await sent).postDataJSON()).toEqual({ code: "rm4k7p", reason: "Told us Rohit sent him" });

  await expect(invite.getByRole("status")).toHaveText("Attached. The CRM is sent it too.");
  // The head names who sent it as the API answered, without the record being read again.
  await expect(invitedBy(page)).toHaveText("Rohit Malhotra (RM4K7P)");
  await expect(invite).toContainText("What it earnsGiven when this client is fitted");
  await expect(invite).toContainText("Attached byops@maneman.in");
  await expect(invite).toContainText("WhyTold us Rohit sent him");
});

test.describe("says why an invite was not attached", () => {
  for (const [code, words] of [
    ["unknown_invite", "No invite has that code."],
    ["own_invite", "That is this client's own invite."],
  ] as const) {
    test(code, async ({ page }) => {
      await openClient(page, `/clients/${CLIENT.id}/referrals`, {
        [READ_RECORD]: json(NEW_RECORD),
        [ATTACH_INVITE]: fails(code === "unknown_invite" ? 422 : 409, code),
      });
      const invite = page.getByRole("region", { name: "Invite" });
      await invite.getByLabel("Invite code").fill("RM4K7P");
      await invite.getByLabel("Why").fill("Told us Rohit sent him");
      await invite.getByRole("button", { name: "Attach the invite" }).click();
      await expect(invite.getByRole("alert")).toContainText(words);
      await expect(invite.getByLabel("Invite code")).toHaveValue("RM4K7P");
    });
  }

  test("already_invited, showing the invite they came with instead", async ({ page }) => {
    let read = 0;
    await openClient(page, `/clients/${CLIENT.id}/referrals`, {
      // The page opens on the record without the invite; the one read after the refusal has it.
      [READ_RECORD]: (route) => {
        read += 1;
        return json(read === 1 ? NEW_RECORD : { ...NEW_RECORD, invite: RECORD.invite })(route);
      },
      [ATTACH_INVITE]: json(
        { error: { code: "already_invited", request_id: "test" }, invite: { code: "VSAB23" } },
        409,
      ),
    });
    const invite = page.getByRole("region", { name: "Invite" });
    await invite.getByLabel("Invite code").fill("RM4K7P");
    await invite.getByLabel("Why").fill("Told us Rohit sent him");
    await invite.getByRole("button", { name: "Attach the invite" }).click();
    await expect(invite.getByRole("status")).toHaveText("They came with this invite already, so nothing was attached.");
    await expect(invitedBy(page)).toHaveText("Vikram Sethi (VSAB23)");
  });
});

test("keeps the photographs locked, and says what opening them records", async ({ page }) => {
  let asked = 0;
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [READ_PHOTOS]: (route) => {
      asked += 1;
      return json(PHOTOS)(route);
    },
  });
  await expect(page.getByText("Locked")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Photographs of ${CLIENT.name}` })).toBeVisible();
  // Why they are kept, whatever the Consents tab says.
  await expect(page.getByText("Taken for the visit record, at every visit.")).toBeVisible();
  await expect(page.getByText("Opening these records your name, the client and the time.")).toBeVisible();
  // Nothing is fetched while it is locked, so nothing is logged.
  expect(asked).toBe(0);
  await expect(page.getByRole("img")).toHaveCount(0);
});

// One opening was ten entries in the log, and the time lettered was the browser's (OPS-17).
test("logs the opening once, before any photograph, and letters the time the API logged", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(`${RECORD_PATH}/photos/`)) asked.push(path.endsWith("/view") ? "view" : "photo");
  });
  await openClient(page, `/clients/${CLIENT.id}/photos`);
  // The browser's clock says otherwise; the API's logged time is the one lettered.
  await page.clock.setFixedTime(new Date("2027-09-22T09:00:00.000Z"));
  await page.getByRole("button", { name: "View photos" }).click();

  await expect(page.getByText("Open · logged 10:42 am")).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(10);
  expect(asked[0]).toBe("view");
  expect(asked.filter((each) => each === "view")).toHaveLength(1);
  await expect(page.getByText("Before", { exact: true })).toBeVisible();
  await expect(page.getByText("After", { exact: true })).toBeVisible();
  await expect(page.getByText("22 Aug 2027 · service visit · Imran Qureshi")).toBeVisible();
});

// The locked state promises a log the city head can see; it is here, beside the photographs.
test("says who opened the photographs before, and when", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/photos`);
  await page.getByRole("button", { name: "View photos" }).click();
  const before = page.getByRole("region", { name: "Opened before" });
  await expect(before.getByRole("listitem")).toHaveText(["ops@maneman.in · 19 Sep 2027, 10:10 am"]);
});

test("shows nothing, and asks for no photograph, when the opening could not be logged", async ({ page }) => {
  let photos = 0;
  page.on("request", (request) => {
    if (/\/photos\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname)) photos += 1;
  });
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [VIEW_PHOTOS]: fails(503, "unavailable"),
  });
  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("alert")).toContainText("The view could not be recorded, so nothing is shown.");
  await expect(page.getByRole("img")).toHaveCount(0);
  expect(photos).toBe(0);
});

test("shows no photograph the API would not serve", async ({ page }) => {
  const first = PHOTOS.visits[0]?.photos[0]?.id ?? "";
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [readPhoto(first)]: fails(503, "unavailable"),
  });
  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("alert")).toContainText("The view could not be recorded");
  await expect(page.getByRole("img")).toHaveCount(9);
});

// Every photograph of every visit was fetched at once (FEO-16).
test("fetches the newest visits' photographs first, and earlier ones when asked", async ({ page }) => {
  const [visit] = PHOTOS.visits;
  if (visit === undefined) throw new Error("the fixture has a visit");
  const earlier = (n: number, date: string) => ({
    ...visit,
    visit_id: `33000000-0000-4000-8000-00000000001${String(n)}`,
    date,
  });
  const three = { visits: [visit, earlier(1, "2027-06-27"), earlier(2, "2026-11-14")] };
  await openClient(page, `/clients/${CLIENT.id}/photos`, { [READ_PHOTOS]: json(three) });
  await page.getByRole("button", { name: "View photos" }).click();

  await expect(page.getByText("27 Jun 2027 · service visit · Imran Qureshi")).toBeVisible();
  await expect(page.getByText("14 Nov 2026 · service visit · Imran Qureshi")).toBeHidden();
  await page.getByRole("button", { name: "Show 1 earlier visit" }).click();
  await expect(page.getByText("14 Nov 2026 · service visit · Imran Qureshi")).toBeVisible();
  await expect(page.getByRole("button", { name: /earlier/ })).toBeHidden();
});

test("lists every consent with its state, date and where it was given, and says ops cannot grant one", async ({
  page,
}) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`);
  const row = (purpose: string) => page.getByRole("row").filter({ hasText: purpose });
  await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
  await expect(row("Photographs taken for the visit record")).toHaveText(/Given\s*14 Nov 2026\s*Profile$/);
  await expect(row("Photographs on referral cards")).toContainText("Refer");
  await expect(row("Photographs in marketing")).toHaveText(/Not given\s*—\s*—$/);
  await expect(row("WhatsApp about visits")).toContainText("Site");
  await expect(row("WhatsApp about launches")).toContainText("Withdrawn");
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  // Read only: the tab offers no way to change one.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

// A consent given by booking a visit in the app (ADR 0080) must read apart from the profile's, and one given before
// a consent recorded where must not be given a place (docs/decisions/0094-where-a-consent-was-given.md).
test("names a consent given by booking, and says where a place was not recorded", async ({ page }) => {
  const placeOf: Readonly<Record<string, ConsentSource>> = {
    photos_own_record: "app_booking",
    photos_referral_cards: null,
    whatsapp_visits: "referral_landing",
  };
  const consents = CONSENTS.consents.map((consent) =>
    consent.purpose in placeOf ? { ...consent, source: placeOf[consent.purpose] ?? null } : consent,
  );
  await openClient(page, `/clients/${CLIENT.id}/consents`, { [READ_CONSENTS]: json({ ...CONSENTS, consents }) });
  const row = (purpose: string) => page.getByRole("row").filter({ hasText: purpose });
  await expect(row("Photographs taken for the visit record")).toContainText("Booking");
  await expect(row("Photographs on referral cards")).toContainText("Not recorded");
  await expect(row("WhatsApp about visits")).toContainText("Invite");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("says when the client has asked to be erased, and leaves it to Deletion requests", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, {
    [READ_CONSENTS]: json(ERASURE_REQUESTED),
  });
  await expect(page.getByText("Erasure requested 18 Sep 2027. It is not decided here.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Erase ${CLIENT.name}` })).toHaveCount(0);
});

// The operators' erasure was a script with a shared secret, on the public host, that left no audit entry (PS-16).
test("erases a client from their page, once ops confirm the request came from their own number", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, { [ERASE]: json(ERASED) });
  const erasing = page.getByRole("region", { name: "Erase this client" });
  await erasing.getByRole("button", { name: `Erase ${CLIENT.name}` }).click();

  const confirm = page.getByRole("group", { name: `Erasing ${CLIENT.name}` });
  await expect(confirm).toBeFocused();
  await expect(confirm).toContainText("Their invoices in Books, eight years, by law");
  const now = confirm.getByRole("button", { name: "Erase now" });
  await expect(now).toBeDisabled();
  await confirm
    .getByRole("checkbox", { name: "I have confirmed this request with them, on their own number." })
    .check();

  const sent = page.waitForRequest((request) => request.url().endsWith("/erasure") && request.method() === "POST");
  await now.click();
  expect((await sent).postDataJSON()).toEqual({});
  await expect(page.getByRole("heading", { name: "Erased" })).toBeVisible();
  await expect(page.getByRole("heading", NAME)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Find another client" })).toBeVisible();
});

test("erases anyway when a visit is booked, once ops say they will settle it by hand today", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, { [ERASE]: json(VISIT_BOOKED, 409) });
  const erasing = page.getByRole("region", { name: "Erase this client" });
  await erasing.getByRole("button", { name: `Erase ${CLIENT.name}` }).click();
  await erasing
    .getByRole("checkbox", { name: "I have confirmed this request with them, on their own number." })
    .check();
  await erasing.getByRole("button", { name: "Erase now" }).click();

  await expect(erasing).toContainText("They still have a visit booked, so nothing was erased.");
  await answer(page, { [ERASE]: json(ERASED) });
  const anyway = erasing.getByRole("button", { name: "Erase anyway" });
  await expect(anyway).toBeDisabled();
  await erasing.getByRole("checkbox", { name: "I will cancel and refund it by hand today." }).check();

  const sent = page.waitForRequest((request) => request.url().endsWith("/erasure") && request.method() === "POST");
  await anyway.click();
  expect((await sent).postDataJSON()).toEqual({ override_open_bookings: true });
  await expect(page.getByRole("heading", { name: "Erased" })).toBeVisible();
});

// The owner's ruling of 24 September 2026: what a client has bought and how
// often they have been served belongs on the ops console as well as in the app.
test("counts the client's visits and replacements, and the day their piece falls due", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/history`);
  const history = page.getByRole("region", { name: "History" });
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
  const history = page.getByRole("region", { name: "History" });
  const fact = (label: string) =>
    history
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("+ dd");
  await expect(fact("First fit")).toHaveText("No first fit on record");
  await expect(fact("Last visit")).toHaveText("No visit done yet");
  await expect(fact("Replacement due")).toHaveText("No piece fitted, so no date");
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
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  await page.getByRole("link", { name: "Pieces" }).click();
  await expect(page.getByText("MM-STD-4417-C")).toBeVisible();
  // Visits, Payments and History are drawn from the record already loaded, so they ask the API for nothing.
  await page.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Gate 4417, bay B")).toBeVisible();
  await clientTab(page, "Payments").click();
  await expect(page.getByRole("region", { name: "Payments and refunds" })).toContainText(
    "Service visit of 22 Aug 2027",
  );
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  // Coming back finds the same opening, logged once: a tab changed is not a second look.
  await page.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Open · logged 10:42 am")).toBeVisible();
  expect(records).toBe(1);
  expect(views).toBe(1);
});

test("says so when the client cannot be loaded, and loads them on Try again", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, { [READ_RECORD]: fails(503, "unavailable") });
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await clientRoutes(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", NAME)).toBeVisible();
});

test("meets WCAG 2.2 AA finding a client, and on every tab, locked and open", async ({ page }) => {
  const clean = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      label,
    ).toEqual([]);
  };

  await answer(page, { [FIND]: json({ clients: [CLIENT], more: false }) });
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
  await expect(page.getByText("Ops cannot grant a consent.")).toBeVisible();
  await clean("consents");

  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  await clean("history");
});
