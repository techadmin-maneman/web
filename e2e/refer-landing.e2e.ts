import { axeViolations } from "./a11y.ts";
// The referral landing at /r/:code against a mocked API, so every answer it can
// give is covered (design/phase2/Referral and Waitlist, C1 to C4).
//
// The static server maps every /r/:code to the built page, as run_worker_first
// does behind Cloudflare. Nothing rewrites the invite into the page here, so the
// island fetches it — the same fallback that runs if the Worker cannot reach
// mm-api.

import { HOUSE_CARD } from "../src/config/house-card.ts";
import type { Page, Request } from "@playwright/test";
import { fillAddress } from "./booking-area.ts";
import {
  analyticsCommands,
  analyticsEvents,
  enterNumberCode,
  expect,
  fakeTurnstile,
  mockNumberCode,
  NUMBER_CODE_ID,
  test,
  visit,
} from "./support.ts";

const CODE = "RM4K7P";

const INVITE = {
  state: "valid" as const,
  referrer_first_name: "Rohit",
  card: { state: "personal" as const, version: 2 },
};

const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

interface Answers {
  invite?: typeof INVITE | { state: "unknown"; referrer_first_name: null; card: { state: "house"; version: number } };
  consultation?: { status: number; body: unknown };
  waitlist?: { status: number; body: unknown };
}

/** Mocks the landing's calls; returns the bookings and waitlist entries it sent. */
async function mockApi(page: Page, answers: Answers = {}): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await mockNumberCode(page);
  // The days and windows open: the API cannot say, so the form draws every window open (e2e/book.e2e.ts answers).
  await page.route(/\/api\/availability\/public\?/, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: answers.invite ?? INVITE }));
  // The invite's card: the API sends an unknown code's browser to the house card (src/routes/public/referral-landing.ts).
  await page.route("**/api/og/*", (route) => route.fulfill({ status: 302, headers: { location: HOUSE_CARD } }));
  await page.route("**/api/pincodes/*", (route) => {
    const pincode = route.request().url().split("/").pop();
    return route.fulfill({ json: pincode === SERVED.pincode ? SERVED : UNSERVED });
  });
  await page.route(`**/api/r/${CODE}/consultation`, (route) => {
    requests.push(route.request());
    const answer = answers.consultation ?? {
      status: 201,
      body: {
        state: "booked",
        date: "2026-09-25",
        window: "morning",
        area: SERVED.area,
        credits: true,
        invite: "valid",
        one_visit: false,
      },
    };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route(`**/api/r/${CODE}/waitlist`, (route) => {
    requests.push(route.request());
    const answer = answers.waitlist ?? { status: 201, body: { area: UNSERVED.area, credits: true, invite: "valid" } };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

/** Everything a consultation needs but the agreement: the address, the name and the number. */
async function fillForm(page: Page): Promise<void> {
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Friend");
  await page.getByLabel("Mobile").fill("9810000000");
}

async function fillPerson(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Test Friend");
  await page.getByLabel("Mobile").fill("9810000000");
}

test("the invite names the referrer, and a served pincode opens the consultation", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await expect(page.getByText("Rohit sent you this")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A hair system, fitted at home. The consultation is free.",
  );
  await expect(page.getByText("Get fitted and you both get 3 service visits free.")).toBeVisible();

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("We come to Sector 65")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Book a free consultation" })).toBeVisible();
  await expect(page.getByText("Rohit is told when you are fitted. That is when the 3 visits land.")).toBeVisible();

  await fillForm(page);
  // The radio itself is visually hidden, as the design has it: a person clicks its label.
  await page.getByText("Afternoon", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Afternoon/ })).toBeChecked();
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Booking received")).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "afternoon", consent: true, mobile: "9810000000" });
  // The form said who is told of the fit, and says so.
  expect(sent.invite_told).toBe(true);
  expect(sent.address).toMatchObject({ line1: "Palm Grove Society", city: SERVED.city, pincode: SERVED.pincode });
  expect(sent.turnstile_token).toBeTruthy();
});

// The booking is the conversion paid campaigns are bought for. The invite's code is a person's, so no
// tag reads it, in the address or anywhere else.
test("a booking through the invite is counted, with nothing personal and no code", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("Afternoon", { exact: true }).click();
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Booking received")).toBeVisible();

  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "invite", served: true, area: "Sector 65", window: "afternoon", loss_extent: null }],
    ["booking_confirmed", { page: "invite", area: "Sector 65", window: "morning", state: "booked" }],
  ]);
  const commands = await analyticsCommands(page);
  expect(commands).toContainEqual(["set", { page_location: `${new URL(page.url()).origin}/r/` }]);
  const sent = JSON.stringify(commands);
  for (const personal of [CODE, "Rohit", "Test Friend", "9810000000", "98100 00000"])
    expect(sent).not.toContain(personal);
  // The next page is told only where the visitor came from, not which invite.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin");
});

// So /book carries it if the friend leaves and books there later (docs/decisions/0089-an-invite-is-not-lost.md).
test("a valid invite is remembered in this browser, and forgotten once its own booking has used it", async ({
  page,
}) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await expect(page.getByText("Rohit sent you this")).toBeVisible();
  const remembered = () => page.evaluate(() => localStorage.getItem("mm_invite"));
  // The island remembers it in an effect after the name is drawn, so the test waits for it rather than racing it.
  await expect.poll(async () => JSON.parse((await remembered()) ?? "{}") as unknown).toMatchObject({ code: CODE });

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Booking received")).toBeVisible();
  // The landing books with its own invite, and sends no other.
  expect(requests[0]?.postDataJSON()).not.toHaveProperty("invite_code");
  expect(await remembered()).toBeNull();
});

test("the invited page does say who is told, and what lands when", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Rohit is told when you are fitted. That is when the 3 visits land.")).toBeVisible();
});

// The owner's ruling of 1 October 2026: ops set each side's visits apart
// (docs/decisions/0107-referral-rewards-in-the-console.md), and the page says what they set.
test("says what ops set each side gets, and promises the friend nothing ops do not give", async ({ page }) => {
  const reward = { referrer_visits: 3, friend_visits: 2, valid_days: 180 };
  await mockApi(page);
  await page.route("**/api/referral-reward", (route) => route.fulfill({ json: reward }));
  await visit(page, `/r/${CODE}`);
  await expect(page.getByText("Get fitted and you get 2 service visits free. Your friend gets 3.")).toBeVisible();
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Rohit is told when you are fitted. That is when the 2 visits land.")).toBeVisible();

  reward.friend_visits = 0;
  await page.reload();
  await expect(page.getByText("Get fitted and your friend gets 3 service visits free.")).toBeVisible();
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Rohit is told when you are fitted.", { exact: true })).toBeVisible();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Booking received")).toBeVisible();
  await expect(page.getByText(/land when you are fitted/)).toHaveCount(0);
});

test("an unserved pincode takes the number instead, and the launch alert is the visitor's choice", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  // The navy block says what the pincode answered, in place of the pincode field (board C3).
  await expect(page.getByText("We are not in Bandra yet")).toBeVisible();
  await expect(page.getByLabel("Pincode", { exact: true })).toBeHidden();
  await expect(page.getByText("For 400050, Bandra")).toBeVisible();
  // Nothing is booked, so nothing asks where (ADR 0081).
  await expect(page.getByLabel("Building or society")).toHaveCount(0);

  await expect(
    page.getByText(
      "Rohit’s invite stays valid for 12 months after we launch there. Rohit is told when you are fitted.",
    ),
  ).toBeVisible();

  await fillPerson(page);
  await page.getByText("You may contact me about this request.").click();
  await page.getByText("Tell me when you launch in my area.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  // They asked to be told, so they are promised a message, naming the pincode they gave.
  await expect(page.getByText("We’ll message you on WhatsApp when we start coming to 400050.")).toBeVisible();
  await expect(page.getByText("Rohit’s invite holds for 12 months from when we start coming to 400050.")).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({
    pincode: UNSERVED.pincode,
    contact_consent: true,
    launch_alert: true,
    invite_told: true,
  });
});

test("a code we do not know still books, without the invite's visits", async ({ page }) => {
  await mockApi(page, {
    invite: { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } },
    consultation: {
      status: 201,
      body: {
        state: "booked",
        date: "2026-09-25",
        window: "morning",
        area: SERVED.area,
        credits: false,
        invite: "unknown",
        one_visit: false,
      },
    },
  });
  await visit(page, `/r/${CODE}`);

  // Headed as /book is, with no line saying there is an invite above the one saying there is not.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book a free consultation");
  await expect(page).toHaveTitle("Book a free consultation — Mane Man");
  await expect(page.getByText("You have an invite")).toBeHidden();
  await expect(page.getByText("We do not recognise this invite")).toBeVisible();
  await expect(page.getByText("The consultation is still free; the 3 service visits do not apply.")).toBeVisible();
  await expect(page.getByText("Get fitted and you both get 3 service visits free.")).toBeHidden();

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  // The API books this one with no invite, so nobody is told and no visits land (REQ-S8-01).
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
  await expect(page.getByText(/is told when you are fitted/)).toHaveCount(0);

  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Booking received")).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

test("a code we do not know promises nothing to hold on the waitlist either", async ({ page }) => {
  await mockApi(page, {
    invite: { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } },
  });
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Add me to the list" })).toBeVisible();
  await expect(page.getByText(/invite stays valid/)).toHaveCount(0);
});

// The invite could not be fetched, which says nothing about the code. The page neither calls it unknown
// nor promises its visits, and it books as ever.
test("an invite that cannot be fetched is neither refused nor promised", async ({ page }) => {
  await mockApi(page);
  await page.route(`**/api/r/${CODE}`, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await visit(page, `/r/${CODE}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A hair system, fitted at home. The consultation is free.",
  );
  await expect(page.getByText("You have an invite")).toBeVisible();
  await expect(page.getByText("We do not recognise this invite")).toBeHidden();
  await expect(page.getByText(/3 service visits/)).toHaveCount(0);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(/is told when you are fitted/)).toHaveCount(0);
});

// The owner took the prices off the site on 1 October 2026 (ADR 0103): the invite gives none, and asks for none.
test("the invite gives no price, and never asks the price book", async ({ page }) => {
  await mockApi(page);
  let asked = 0;
  await page.route("**/api/published-prices", (route) => {
    asked += 1;
    return route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } });
  });
  await visit(page, `/r/${CODE}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Rs\. \d/)).toHaveCount(0);
  expect(asked).toBe(0);
});

// With self-serve booking off, the API records the day asked for and answers
// "requested" (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
// The friend sees the same frame, saying ops fix the hour, rather than an error
// that sends them away to type it all again.
test("a consultation nobody can book outright is confirmed as a request", async ({ page }) => {
  await mockApi(page, {
    consultation: {
      status: 201,
      body: {
        state: "requested",
        date: "2026-09-25",
        window: "morning",
        area: SERVED.area,
        credits: true,
        invite: "valid",
        one_visit: false,
      },
    },
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Request received")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We will message you");
  await expect(page.getByText("On WhatsApp, at +91 98100 00000, to fix the hour.")).toBeVisible();
  // The invite still stands, and nothing says the visit is booked.
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  await expect(page.getByText("Booking received")).toBeHidden();
});

test("a pincode that is not six digits is refused before the API is asked", async ({ page }) => {
  let asked = false;
  await mockApi(page);
  await page.route("**/api/pincodes/*", (route) => {
    asked = true;
    return route.fulfill({ json: SERVED });
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill("12");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That isn’t a six-digit Indian pincode.")).toBeVisible();
  expect(asked).toBe(false);
});

test("a window found full says so, and the form stays", async ({ page }) => {
  await mockApi(page, {
    consultation: { status: 409, body: { error: { code: "taken", request_id: "r" } } },
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("That time isn’t available. Pick another.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
});

// The date strip scrolls sideways; the page must not. A hidden radio inside it is absolutely
// positioned, and without a positioned parent it is placed against the document and widens it.
test("the page does not scroll sideways, whatever the pincode says", async ({ page }) => {
  await mockApi(page);
  for (const pincode of [SERVED.pincode, UNSERVED.pincode]) {
    await visit(page, `/r/${CODE}`);
    await page.getByLabel("Pincode").fill(pincode);
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("button", { name: /Book the consultation|Add me to the list/ })).toBeVisible();
    const width = page.viewportSize()?.width ?? 0;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("the form will not send without the address, a name, a number and the agreement", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Enter your name, in letters.")).toBeVisible();
  await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible();
  await expect(page.getByText("We need this to contact you.")).toBeVisible();
  await expect(page.getByText("Enter the building or society.")).toBeVisible();
  await expect(page.getByText("Enter the sector or area.")).toBeVisible();
  expect(requests).toHaveLength(0);
});

// The answer used to replace the focused button, dropping focus to the page and saying nothing. A
// mistyped pincode could only be undone by reloading the page.
test("the pincode's answer is announced, and the pincode can be changed", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByLabel("Pincode").press("Enter");
  await expect(page.getByRole("heading", { name: "We are not in Bandra yet" })).toBeFocused();

  await page.getByRole("button", { name: "Change the pincode" }).click();
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await expect(page.getByLabel("Pincode")).toHaveValue(UNSERVED.pincode);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeFocused();
  await expect(page.getByText(`For ${SERVED.pincode}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
});

// What must be filled in says so to a screen reader, before any error.
test("the fields the form needs are marked as required", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await expect(page.getByLabel("Pincode")).toHaveAttribute("aria-required", "true");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-required", "true");
  await expect(page.getByLabel("Mobile")).toHaveAttribute("aria-required", "true");
  await expect(page.getByRole("checkbox")).toHaveAttribute("aria-required", "true");
  for (const part of ["Flat or house number", "Building or society", "Sector or area", "City"]) {
    await expect(page.getByLabel(part)).toHaveAttribute("aria-required", "true");
  }
  for (const part of ["Street (optional)", "Access notes (optional)"]) {
    await expect(page.getByLabel(part)).not.toHaveAttribute("aria-required");
  }
});

/**
 * The outline a keyboard user sees for the focused hidden radio or checkbox: on its label, or on the box drawn
 * inside the label for a checkbox.
 */
function outlineOf(page: Page, drawn: "label" | "box"): Promise<string> {
  return page.evaluate((part) => {
    const label = document.activeElement?.closest("label") ?? null;
    const element = part === "label" ? label : (label?.querySelector("[aria-hidden='true']") ?? null);
    if (element === null) return "nothing focused";
    const style = getComputedStyle(element);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  }, drawn);
}

// The radios and checkboxes are hidden and drawn, so the keyboard's focus must be drawn too.
test("a keyboard user sees which day, window and agreement has focus", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByLabel("Pincode").press("Enter");
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeFocused();

  await page.keyboard.press("Tab"); // Change the pincode
  await page.keyboard.press("Tab"); // what to book (ADR 0086)
  await expect(page.getByRole("radio", { name: "Consultation · an hour" })).toBeFocused();
  expect(await outlineOf(page, "label")).toBe("solid 2px");
  await page.keyboard.press("Tab"); // the date strip
  await expect(page.getByRole("group", { name: "Pick a date" }).getByRole("radio").first()).toBeFocused();
  expect(await outlineOf(page, "label")).toBe("solid 2px");
  await page.keyboard.press("Tab"); // the windows
  await expect(page.getByRole("radio", { name: /Morning/ })).toBeFocused();
  expect(await outlineOf(page, "label")).toBe("solid 2px");
  // The address: flat, the button that unfolds the floor, tower and landmark, building, street, area, city and
  // access notes.
  for (let field = 0; field < 7; field += 1) await page.keyboard.press("Tab");
  await expect(page.getByLabel("Access notes (optional)")).toBeFocused();
  await page.keyboard.press("Tab"); // name
  await page.keyboard.press("Tab"); // mobile
  await page.keyboard.press("Tab"); // the agreement
  await expect(page.getByRole("checkbox")).toBeFocused();
  expect(await outlineOf(page, "box")).toBe("solid 2px");
});

// A retap after the answer was lost is the same request, so it carries the same key.
test("pressing again after a lost answer sends the same request key", async ({ page }) => {
  await mockApi(page);
  const keys: (string | undefined)[] = [];
  await page.route(`**/api/r/${CODE}/consultation`, (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) return route.abort("internetdisconnected");
    const body = {
      state: "booked",
      date: "2026-09-25",
      window: "morning",
      area: SERVED.area,
      credits: true,
      invite: "valid",
      one_visit: false,
    };
    return route.fulfill({ status: 201, json: body });
  });
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Something went wrong on our side. Try again.")).toBeVisible();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Booking received")).toBeVisible();

  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

// Turnstile's script failing to load once used to fail every booking until the page was reloaded.
test("Turnstile that failed to load is tried again when the form is sent", async ({ page }) => {
  const requests = await mockApi(page);
  let failed = false;
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) => {
    if (failed) return route.fallback();
    failed = true;
    return route.abort("internetdisconnected");
  });
  await visit(page, `/r/${CODE}`);
  await bookThrough(page);
  await expect(page.getByText("Booking received")).toBeVisible();
  expect(failed).toBe(true);
  expect(requests).toHaveLength(1);
});

async function bookThrough(page: Page): Promise<void> {
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
}

// The invite had lapsed for this friend, which only the booking's answer can say (ADR 0025, item 40).
test("an invite that has expired for this friend says so once the booking is made", async ({ page }) => {
  const expired = { state: "booked", date: "2026-09-25", window: "morning", area: SERVED.area, credits: false };
  await mockApi(page, { consultation: { status: 201, body: { ...expired, invite: "expired", one_visit: false } } });
  await visit(page, `/r/${CODE}`);
  await bookThrough(page);
  await expect(page.getByText("Booking received")).toBeVisible();
  await expect(page.getByText("Code expired")).toBeVisible();
  await expect(page.getByRole("heading", { name: "This invite has expired" })).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

// The booking ends the same for every number, sending its details to the number on WhatsApp, and opening the
// client app with the number filled in; the code is still asked for there.
test("a booking sends the details to WhatsApp, and opens the app with the number filled in", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await bookThrough(page);
  await expect(page.getByRole("heading", { level: 1, name: "Check WhatsApp" })).toBeVisible();
  await expect(page.getByText("Your booking details are on their way to +91 98100 00000.")).toBeVisible();
  await expect(page.getByText("See it in the app too: sign in with this number.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to calendar" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/");
  const app = page.getByRole("link", { name: "Open the app" });
  await expect(app).toHaveAttribute("href", "http://app.localhost:4322");
  await page.route(/^http:\/\/app\.localhost:4322\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>App</title>" }),
  );
  await app.click();
  await expect(page).toHaveURL("http://app.localhost:4322/#mobile=9810000000");
});

// The owner's ruling D2 of 1 October 2026 (ADR 0025, item 89; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the form offers the consultation alone, or the consultation and fit in one visit, paid for once fitted. It replaces
// the consultation with the first fit to follow, whose test went with it.
test("offers the consultation alone or with the fit in one visit, and asks ops for it while booking is off", async ({
  page,
}) => {
  const asked = {
    state: "requested",
    date: "2026-09-25",
    window: "morning",
    area: SERVED.area,
    credits: true,
    invite: "valid",
    one_visit: true,
  };
  const requests = await mockApi(page, { consultation: { status: 201, body: asked } });
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();

  const plan = page.getByRole("group", { name: "What to book" });
  await expect(plan.getByRole("radio", { name: "Consultation · an hour" })).toBeChecked();
  await plan.getByText("Consultation and fit · three hours").click();
  await expect(
    plan.getByText(/Choose your hair system with your technician and have it fitted there and then\./),
  ).toBeVisible();
  // The form's heading follows what it books.
  await expect(page.getByRole("heading", { level: 2, name: "Book a consultation and fit" })).toBeVisible();
  // The morning or the afternoon: the first fit's three hours cannot start in the evening.
  await expect(page.getByRole("group", { name: "Window" }).getByRole("radio")).toHaveCount(2);
  // The invite is this page's offer: no discount code here (docs/decisions/0108-discount-codes.md).
  await expect(page.getByLabel("Discount code (optional)")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await fillForm(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation and fit" }).click();
  // Asked for only once the WhatsApp code sent to the number is entered.
  await enterNumberCode(page, "Confirm and book");

  await expect(page.getByText("Request received")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent.one_visit).toBe(true);
  expect(sent.number_code_id).toBe(NUMBER_CODE_ID);
  // The consent recorded is the consultation's own line, unchanged.
  expect(sent.consent).toBe(true);
});

test("a consultation asked for, not booked, still offers the app, where the request shows", async ({ page }) => {
  const requested = { state: "requested", date: "2026-09-25", window: "morning", area: SERVED.area, credits: true };
  await mockApi(page, { consultation: { status: 201, body: { ...requested, invite: "valid", one_visit: false } } });
  await visit(page, `/r/${CODE}`);
  await bookThrough(page);
  await expect(page.getByText("Request received")).toBeVisible();
  await expect(page.getByText("Booking received")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();
});

// At 1440 the card sits beside the headline (board C5), and no field runs the width of the page.
test("the desktop page is board C5's two columns, and its fields keep to their column", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width < 1024, "board C5 is the desktop page");
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  const card = await page.locator("img[width='1200']").boundingBox();
  expect(card?.x ?? 0).toBeGreaterThan(width / 2);
  expect(card?.y ?? 0).toBeLessThan(title?.y ?? 0);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  for (const field of ["Building or society", "Name"]) {
    const box = await page.getByLabel(field).boundingBox();
    expect(box?.width ?? 0, field).toBeLessThanOrEqual(width / 2);
  }
});

// On a phone the pincode, the one field a friend must fill, is on the first screen, above how it works.
test("on a phone the pincode comes before how it works, on the first screen", async ({ page }) => {
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  test.skip(size.width >= 1024, "board C5 puts how it works in the other column");
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  const pincode = await page.getByLabel("Pincode").boundingBox();
  const steps = await page.getByRole("heading", { name: "How it works" }).boundingBox();
  expect(pincode).not.toBeNull();
  expect(steps).not.toBeNull();
  expect(pincode?.y ?? 0).toBeLessThan(steps?.y ?? 0);
  expect((pincode?.y ?? 0) + (pincode?.height ?? 0)).toBeLessThanOrEqual(size.height);
});

// At 320 px, the narrowest phone WCAG asks for, nothing is cut off and the page does not scroll sideways.
test("the form fits a 320 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const field of ["Building or society", "Access notes (optional)", "Name", "Mobile"]) {
    const box = await page.getByLabel(field).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0), field).toBeLessThanOrEqual(320);
  }
  const lastDay = await page.locator("label:has(input[name='date'])").last().boundingBox();
  expect((lastDay?.x ?? 0) + (lastDay?.width ?? 0)).toBeLessThanOrEqual(320);
});
