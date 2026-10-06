// The client app's profile (boards G1 and G2), against the local mm-api, logged
// in with the local fixed code (OTP_FIXED_CODE in playwright.config.ts).

import type { Page } from "@playwright/test";
import { expect, randomMobile, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { holdOpen } from "./one-tap.ts";
import { CODE, logIn, signIn } from "./signed-in.ts";

async function loggedIn(page: Page): Promise<string> {
  const mobile = await signIn(page);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  return mobile;
}

test("opens from Home's button, with the client's name and a way back", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByRole("banner")).toContainText("Rohit Malhotra");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("keeps the tabs at the foot of the screen, and scrolls only the page, however long it is", async ({ page }) => {
  await loggedIn(page);
  const tabs = await page.getByRole("navigation").boundingBox();
  expect((tabs?.y ?? 0) + (tabs?.height ?? 0)).toBe(844);
  const heights = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    page: document.querySelector("main")?.scrollHeight ?? 0,
  }));
  expect(heights.document).toBe(844);
  expect(heights.page).toBeGreaterThan(844);
});

test("shows board B3's loading shape while the profile comes", async ({ page }) => {
  await signIn(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/profile", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeAttached();
  release();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
});

test("takes an address and its access notes, and shows them", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByText("No address yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Building, society or street").fill("Tower C");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByLabel("Access notes (optional)").fill("Gate code 4417 · park in visitor bay B");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("House 4417, Tower C, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate code 4417 · park in visitor bay B")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit address and access notes" })).toBeVisible();

  // Home's consultation card now shows the address.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("Sector 65, Gurgaon 122018")).toBeVisible();
});

// The building search (ADR 0054). The local API runs the stub provider, whose
// suggestions are synthetic Gurugram societies.
test("finds a building, keeps the flat separately, and shows the address as written", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("Sunrise");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Sunrise Greens");
  // Google's condition for showing their suggestions without a Google map.
  await expect(page.getByText("Google Maps")).toBeVisible();
  await options.first().click();
  await expect(search).toHaveValue("Sunrise Greens");

  await page.getByLabel("Flat or house number").fill("Flat 1203");
  await page.getByLabel("Floor (optional)").fill("12");
  await page.getByLabel("Tower or block (optional)").fill("Tower C");
  await page.getByLabel("Landmark (optional)").fill("Opposite the sector market");
  // The chosen building is line one, so the free-text building field is gone.
  await expect(page.getByLabel("Building, society or street")).toBeHidden();
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Flat 1203, 12, Tower C, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  // As the client typed it, under its own label, never "Near Opposite the sector market".
  await expect(page.getByText("Landmark", { exact: true })).toBeVisible();
  await expect(page.getByText("Opposite the sector market", { exact: true })).toBeVisible();
  await expect(page.getByText(/Near Opposite/)).toHaveCount(0);
});

test("the suggestion list works by keyboard alone", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("Sec");
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(search).toHaveAttribute("aria-expanded", "true");

  await search.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowDown");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(search).toHaveValue("Mayfield Towers");
  await expect(page.getByRole("option")).toHaveCount(0);

  // Escape closes the list without choosing.
  await search.fill("Sec");
  await expect(page.getByRole("option")).toHaveCount(3);
  await search.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
});

test("an address can still be typed when the search gives nothing", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  // The stub answers this query with a 503, as a spent quota or an outage would.
  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("mm-stub:down");
  await expect(page.getByText("Search isn’t available right now. Type your address below instead.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Whatever is in the box stands as words: no suggestion was chosen, so no pin.
  await search.fill("Sunrise Greens");
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("House 4417, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
});

test("refuses an address without a six-digit pincode", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 1");
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("1220");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  // The field that is wrong is marked, named by the error, and given the focus.
  const pincode = page.getByLabel("Pincode");
  await expect(pincode).toHaveAttribute("aria-invalid", "true");
  await expect(pincode).toHaveAccessibleDescription(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  await expect(pincode).toBeFocused();
  await expect(page.getByLabel("City")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("City")).toHaveAttribute("required", "");
});

// The owner's ruling of 27 September 2026: FSM's work order must name the door (docs/open-points.md, item 45).
test("refuses an address without the flat or house number, and says so on the flat", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  );
  const flat = page.getByLabel("Flat or house number");
  await expect(flat).toHaveAttribute("aria-invalid", "true");
  await expect(flat).toHaveAttribute("required", "");
  await expect(flat).toBeFocused();
});

// Saved, the form closes on its own heading, so the client lands where they were rather than mid-page.
// An address the client gave ops on the phone, which ops saved for them (docs/decisions/0092-task-owners.md).
test("says an address was given to us on the phone, so the client can check it", async ({ page }) => {
  await signIn(page);
  // Only the browser resolves app.localhost, so the profile is answered whole rather than fetched and changed.
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      json: {
        name: "Rohit Malhotra",
        mobile: "+91 98xxx x4417",
        consents: [],
        number_change: null,
        number_change_decided: null,
        deletion: null,
        deletion_rejected: null,
        grievances: [],
        address: {
          line1: "Sunrise Greens",
          line2: null,
          locality: "Sector 65",
          city: "Gurgaon",
          pincode: "122018",
          access_notes: null,
          building: "Sunrise Greens",
          flat: "Flat 1203",
          floor: null,
          tower: null,
          landmark: null,
          place_id: null,
        },
        address_given_to_ops: "2026-09-21T06:30:00.000Z",
      },
    });
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByText("Flat 1203, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("You gave us this address on the phone on 21 Sep 2026.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit address and access notes" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("lands on where we come once the address is saved", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("Flat or house number").fill("House 4417");
  await page.getByLabel("Building, society or street").fill("Palm Grove Society");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();
  const heading = page.getByRole("heading", { name: "Where we come" });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test("lists the five consents off, and switches one on with its date and off again", async ({ page }) => {
  await loggedIn(page);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(5);
  for (const name of [
    "Photographs taken for your visit record",
    "Photographs on referral cards",
    "Photographs in our marketing",
    "WhatsApp about your visits",
    "WhatsApp about launches",
  ]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
  }
  // Visit messages off, the client is told what that means; and that visits are photographed all the same.
  const visitsOff = page.getByText("No visit updates on WhatsApp. We’ll call you about any change.");
  await expect(visitsOff).toBeVisible();
  await expect(page.getByText("Each visit is still photographed for your visit record.")).toBeVisible();

  const visits = page.getByRole("switch", { name: "WhatsApp about your visits" });
  const switched = page.waitForRequest("**/api/consents/whatsapp_visits");
  await visits.click();
  await expect(visits).toHaveAttribute("aria-checked", "true");
  await expect(visitsOff).toHaveCount(0);
  // Kept as given in the profile (docs/decisions/0094-where-a-consent-was-given.md).
  expect((await switched).postDataJSON()).toEqual({ granted: true, source: "app_profile" });
  await expect(page.getByText(/^Given \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "WhatsApp about your visits" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("switch", { name: "WhatsApp about your visits" }).click();
  await expect(page.getByRole("switch", { name: "WhatsApp about your visits" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(visitsOff).toBeVisible();
});

test("shows the referral card's lines, and the naming line, before that consent can be switched on", async ({
  page,
}) => {
  await loggedIn(page);
  const cards = page.getByRole("switch", { name: "Photographs on referral cards" });
  await cards.click();
  await expect(page.getByText("Anyone you send this card to can see your photographs.")).toBeVisible();
  await expect(
    page.getByText("Cards already delivered stay in people’s chats. We cannot take those back."),
  ).toBeVisible();
  await expect(page.getByText("Your first name appears on your invite.")).toBeVisible();
  await page.getByRole("button", { name: "Keep it off" }).click();
  await expect(cards).toHaveAttribute("aria-checked", "false");

  await cards.click();
  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(cards).toHaveAttribute("aria-checked", "true");
});

test("changes the number: a code to each, then it waits for us", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("textbox", { name: "New number" }).fill(randomMobile());
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByText("Enter the code sent to each number.")).toBeVisible();
  await page.getByLabel("Code sent to your current number").fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  await page.getByRole("button", { name: "Check the codes" }).click();
  await expect(
    page.getByText(/^We’ll confirm the change to \+91 \d{2}xxx x\d{4} with you, then it takes effect\.$/),
  ).toBeVisible();

  // Until we decide it, the client can take it back, and start afresh.
  await page.getByRole("button", { name: "Withdraw this change" }).click();
  await expect(page.getByRole("button", { name: "Start the change" })).toBeVisible();
  await expect(page.getByText(/^We will confirm the change/)).toHaveCount(0);
});

// A switch the API did not answer stays as it was, and says so: a switch that looks off while the consent stands
// would tell the client something untrue about their data.
test("a consent that did not go through says so, and the switch stays as it was", async ({ page }) => {
  await loggedIn(page);
  await page.route("**/api/consents/*", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "test" } } }),
  );
  const visits = page.getByRole("switch", { name: "WhatsApp about your visits" });
  await visits.click();
  await expect(page.getByRole("alert")).toHaveText("That didn’t go through, so nothing has changed. Try again.");
  await expect(visits).toHaveAttribute("aria-checked", "false");
});

test("a deletion request that did not go through says so, and asks again", async ({ page }) => {
  await loggedIn(page);
  await page.route("**/api/deletion-request", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "test" } } }),
  );
  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Yes, request deletion" }).click();
  await expect(page.getByRole("alert")).toHaveText("That didn’t go through, so nothing was requested. Try again.");
  await expect(page.getByRole("button", { name: "Yes, request deletion" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toHaveCount(0);
});

test("starts one number change, and checks the codes once, however often each is tapped", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("textbox", { name: "New number" }).fill(randomMobile());

  // Starting again withdraws the request just made and sends a fresh pair: four codes for one intent.
  const starts = await holdOpen(page, "**/api/number-change");
  const start = page.getByRole("button", { name: "Start the change" });
  await start.click();
  const startLive = await start.isEnabled();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await start.click({ force: true });
  await expect(page.getByText("Enter the code sent to each number.")).toBeVisible();

  await page.getByLabel("Code sent to your current number").fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  // One tap checks both numbers, one after the other, so two requests are one intent and four are two.
  const checks = await holdOpen(page, "**/api/number-change/verify");
  const check = page.getByRole("button", { name: "Check the codes" });
  await check.click();
  const checkLive = await check.isEnabled();
  await check.click({ force: true });
  // Both numbers checked: a second pair, tapped the same second, was let go with the first (e2e/app/one-tap.ts).
  await expect(page.getByText(/^We’ll confirm the change to /)).toBeVisible({ timeout: 15_000 });

  expect({ starts: starts.asked(), checks: checks.asked(), startLive, checkLive }).toEqual({
    starts: 1,
    checks: 2,
    startLive: false,
    checkLive: false,
  });
});

test("saves the address once when Save is tapped twice", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("Sunrise");
  await page.getByRole("option").first().click();
  await page.getByLabel("Flat or house number").fill("Flat 1203");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");

  // A second save sends the search's session token again, and Google bills a second Place Details
  // resolution against a session that was meant to close once (ADR 0054).
  const held = await holdOpen(page, "**/api/profile/address");
  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  const liveWhileBusy = await save.isEnabled();
  await save.click({ force: true });

  await expect(page.getByText("Flat 1203, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  expect({ asked: held.asked(), liveWhileBusy }).toEqual({ asked: 1, liveWhileBusy: false });
});

test("raises one grievance when Send is tapped twice", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Raise a concern" }).click();
  await page.getByRole("textbox", { name: "Your concern" }).fill("Please explain who sees my photographs.");

  // Every grievance ops see carries its own answer-time clock, so two rows would be one client's
  // one concern counted twice against a regulated 30 days (docs/decisions/0049-dpdp.md).
  const held = await holdOpen(page, "**/api/grievances");
  const send = page.getByRole("button", { name: "Send" });
  await send.click();
  const liveWhileBusy = await send.isEnabled();
  await send.click({ force: true });

  await expect(
    page.getByText(
      "Received. We reply here and on WhatsApp, usually within a working day and within 30 days at the latest.",
    ),
  ).toBeVisible();
  expect({ asked: held.asked(), liveWhileBusy }).toEqual({ asked: 1, liveWhileBusy: false });
});

test("refuses the client's own number as the new one", async ({ page }) => {
  const mobile = await loggedIn(page);
  await page.getByRole("textbox", { name: "New number" }).fill(mobile);
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a ten-digit mobile number, not the one you use now.");
});

test("offers support on WhatsApp, with the design's line", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/919007973247",
  );
  await expect(page.getByText("Replies within a working day. Everything in writing.")).toBeVisible();
});

test("Your data: a download of everything held, and a concern sent to ops", async ({ page }) => {
  await loggedIn(page);
  await expect(page.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/me/export.html");
  await page.getByRole("button", { name: "Raise a concern" }).click();
  await page.getByRole("textbox", { name: "Your concern" }).fill("Please explain who sees my photographs.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(
      "Received. We reply here and on WhatsApp, usually within a working day and within 30 days at the latest.",
    ),
  ).toBeVisible();
  const concerns = page.getByRole("list", { name: "Your concerns" });
  await expect(concerns).toContainText("Please explain who sees my photographs.");
  await expect(concerns).toContainText("Awaiting our reply");
});

test("shows the concerns the client raised, and our answer", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      json: {
        name: "Rohit Malhotra",
        mobile: "+91 98xxx x4417",
        consents: [],
        number_change: null,
        number_change_decided: null,
        deletion: null,
        deletion_rejected: null,
        address: null,
        address_given_to_ops: null,
        grievances: [
          {
            id: "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f",
            text: "Who sees my photographs?",
            state: "resolved",
            raised_at: "2026-10-02T06:30:00.000Z",
            response: "Only your technician and our care team.",
            answered_at: "2026-10-03T06:30:00.000Z",
          },
        ],
      },
    });
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  const concerns = page.getByRole("list", { name: "Your concerns" });
  await expect(concerns.getByText("Your concern of 2 Oct 2026 · Answered 3 Oct 2026")).toBeVisible();
  await expect(concerns.getByText("Who sees my photographs?")).toBeVisible();
  await expect(concerns.getByText("Our answer: Only your technician and our care team.")).toBeVisible();
});

test("asks before requesting deletion, then says it is requested", async ({ page }) => {
  await loggedIn(page);
  await expect(
    page.getByText("Deleted within 30 days of your request. Invoices kept eight years, by law."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Keep my account" }).click();
  await expect(page.getByRole("button", { name: "Request deletion" })).toBeVisible();

  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Yes, request deletion" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toHaveText(
    /^Deletion requested on \d{1,2} [A-Z][a-z]{2} \d{4}\. We’ll confirm on WhatsApp\.$/,
  );
});

test("says when ops kept the account, and why, and still lets the client ask again", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      json: {
        name: "Rohit Malhotra",
        mobile: "+91 98xxx x4417",
        consents: [],
        number_change: null,
        number_change_decided: null,
        deletion: null,
        deletion_rejected: { decided_at: "2026-10-02T06:30:00.000Z", reason: "You still have a consultation booked" },
        address: null,
        address_given_to_ops: null,
        grievances: [],
      },
    });
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByText("On 2 Oct 2026 we didn’t delete your account.")).toBeVisible();
  await expect(page.getByText("Our reason: You still have a consultation booked")).toBeVisible();
  await expect(page.getByText("Message us if you disagree, or ask again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request deletion" })).toBeVisible();
});

test("logs out from the foot of the profile", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

// A lost or handed-on phone stayed signed in for 90 days, with no way to end it short of erasure.
test("lists where the client is signed in, and signs another browser out", async ({ page, browser }) => {
  const mobile = await signIn(page);
  const iPhone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1";
  const phone = await (
    await browser.newContext({ baseURL: test.info().project.use.baseURL, userAgent: iPhone })
  ).newPage();
  await logIn(phone, mobile);
  await expect(phone.getByRole("heading", { name: "Your consultation" })).toBeVisible();

  await page.getByRole("link", { name: "Your profile" }).click();
  const card = page.getByRole("region", { name: "Signed in on" });
  await expect(card.getByText("This device")).toBeVisible();
  await card.getByRole("button", { name: "Sign out Safari on iOS" }).click();
  await expect(card.getByText("Safari on iOS")).toHaveCount(0);

  await phone.reload();
  await expect(phone.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

test("meets WCAG 2.2 AA, with the address form and the card's lines open", async ({ page }) => {
  await loggedIn(page);
  const scan = async () => {
    expect(await axeViolations(page)).toEqual([]);
  };
  await scan();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByRole("switch", { name: "Photographs on referral cards" }).click();
  await scan();

  // Again with the suggestion list open, which is the app's only combobox.
  await page.getByRole("combobox", { name: "Search for your building" }).fill("Sec");
  await expect(page.getByRole("option")).toHaveCount(3);
  await scan();
});
