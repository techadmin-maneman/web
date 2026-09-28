// One client's page (boards B1 to B3): finding them by part of their name or
// number, the ways to reach them, their visits, pieces and payments, their
// photographs, which are opened as one logged view, and their consents, which
// ops read and never change. The API is answered from e2e/ops/fixtures.ts,
// since no route seeds a client's pieces or photographs.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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
  NEW_RECORD,
  PHOTOS,
  PIECES,
  RECORD,
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
const ADD_CREDITS: Call = `POST ${RECORD_PATH}/credits`;
const ATTACH_INVITE: Call = `POST ${RECORD_PATH}/referral`;
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

/** The client's routes, with every photograph a block of ink; `over` replaces any of them. */
async function clientRoutes(page: Page, over: Answers = {}): Promise<void> {
  await answer(page, {
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_PHOTOS]: json(PHOTOS),
    [VIEW_PHOTOS]: json(VIEW),
    [READ_CONSENTS]: json(CONSENTS),
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

// A client could be found only by their whole number, typed exactly (OPS-04).
test("finds clients by part of a name, and sends it in the body, never in the URL", async ({ page }) => {
  await answer(page, {
    [FIND]: json({ clients: [CLIENT], more: false }),
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
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
  expect(new URL(page.url()).pathname).toBe(`/clients/${CLIENT.id}`);
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
  await expect(meta(page)).toHaveText(["Fitted", "2 · expire 3 Jan 2028", "Mar 2028", MOBILE]);
  await expect(page.getByRole("link", { name: `Call ${CLIENT.name} on ${MOBILE}` })).toHaveAttribute(
    "href",
    `tel:${CLIENT.mobile}`,
  );
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
  await expect(meta(page)).toHaveText(["Booked", "2 · expire 3 Jan 2028", "No piece fitted", MOBILE]);
});

test("opens on the pieces, as the board draws the page, and lists them in the board's columns", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`);
  await expect(page.getByRole("navigation", { name: CLIENT.name }).getByRole("link")).toHaveText([
    "Visits",
    "Pieces",
    "Payments",
    "Consents",
    "Photos",
    "History",
  ]);
  await expect(page.getByRole("link", { name: "Pieces" })).toHaveAttribute("aria-current", "page");

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
});

test("says so when there is no address and no visit either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(page.getByText("No address saved yet.")).toBeVisible();
  await expect(page.getByText("Nothing booked.")).toBeVisible();
  await expect(page.getByText("No visit done yet.")).toBeVisible();
});

test("lists what the client has paid, and what for", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("20 Aug 2027");
  await expect(payment).toContainText("Service visit of 22 Aug 2027");
  await expect(payment).toContainText("Rs. 2,360");
  await expect(payment).toContainText("Paid · Ref MM-2027-0841");
});

// A credit given or taken in error once needed SQL to put right (BIZ-15).
test("puts a client's credits right, with the reason, and shows the balance it answers", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
    [ADD_CREDITS]: json({ visits: 1, earliest_expiry: "2028-01-03T06:00:00.000Z" }),
  });
  const credits = page.getByRole("region", { name: "Service-visit credits" });
  await expect(credits).toContainText("2 visits The soonest expires 3 Jan 2028.");
  const save = credits.getByRole("button", { name: "Put the credits right" });
  await expect(save).toBeDisabled();

  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-1");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  const sent = page.waitForRequest((request) => request.url().endsWith("/credits") && request.method() === "POST");
  await save.click();
  expect((await sent).postDataJSON()).toEqual({ visits: -1, reason: "correction" });

  await expect(credits.getByRole("status")).toHaveText("Done. They now hold 1 visit.");
  // The head reads the balance the API answered, without the record being read again.
  await expect(meta(page).nth(1)).toHaveText("1 · expire 3 Jan 2028");
});

test("offers no change of nought, or of more than twelve visits either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const credits = page.getByRole("region", { name: "Service-visit credits" });
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
  const credits = page.getByRole("region", { name: "Service-visit credits" });
  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-5");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  await credits.getByRole("button", { name: "Put the credits right" }).click();
  await expect(credits.getByRole("alert")).toContainText("That would take away more visits than they hold");
});

// A friend who booked away from the invite's page earned their referrer nothing until ops could attach it (ADR 0089).
test("names the invite a client came with, who sent it, and where its visits stand", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const invite = page.getByRole("region", { name: "Invite" });
  await expect(invite).toContainText("CodeVSAB23");
  await expect(invite.getByRole("link", { name: "Vikram Sethi" })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000009",
  );
  await expect(invite).toContainText("Their 3 visitsGiven");
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
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
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
  await expect(invite).toContainText("CodeRM4K7P");
  await expect(invite).toContainText("Their 3 visitsGiven to both when this client is fitted");
  await expect(invite).toContainText("Attached byops@maneman.in");
  await expect(invite).toContainText("WhyTold us Rohit sent him");
});

test.describe("says why an invite was not attached", () => {
  for (const [code, words] of [
    ["unknown_invite", "No invite has that code."],
    ["own_invite", "That is this client's own invite."],
    ["already_fitted", "They have had their first fit, so no invite can be attached now."],
  ] as const) {
    test(code, async ({ page }) => {
      await openClient(page, `/clients/${CLIENT.id}/payments`, {
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
    await openClient(page, `/clients/${CLIENT.id}/payments`, {
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
    await expect(invite).toContainText("CodeVSAB23");
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
  await expect(row("Photographs for the client record")).toHaveText(/Givens*14 Nov 2026s*Profile$/);
  await expect(row("Photographs on referral cards")).toContainText("Refer");
  await expect(row("Photographs in marketing")).toHaveText(/Not givens*—s*—$/);
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
  await expect(row("Photographs for the client record")).toContainText("Booking");
  await expect(row("Photographs on referral cards")).toContainText("Not recorded");
  await expect(row("WhatsApp about visits")).toContainText("Invite");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("says when the client has asked to be erased", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, {
    [READ_CONSENTS]: json(ERASURE_REQUESTED),
  });
  await expect(page.getByText("Erasure requested 18 Sep 2027. It is not decided here.")).toBeVisible();
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
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByText("Service visit of 22 Aug 2027")).toBeVisible();
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

  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("region", { name: "Service-visit credits" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Invite" })).toBeVisible();
  await clean("payments");

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
