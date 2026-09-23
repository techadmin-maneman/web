// The client app's profile (boards G1 and G2), against the local mm-api, logged
// in with the local fixed code (OTP_FIXED_CODE in playwright.config.ts).

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, randomMobile, test } from "../support.ts";
import { CODE, signIn } from "./signed-in.ts";

async function loggedIn(page: Page, request: APIRequestContext): Promise<string> {
  const mobile = await signIn(page, request);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  return mobile;
}

test("opens from Home's button, with the client's name and a way back", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByRole("banner")).toContainText("Rohit Malhotra");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("keeps the tabs at the foot of the screen, and scrolls only the page, however long it is", async ({
  page,
  request,
}) => {
  await loggedIn(page, request);
  const tabs = await page.getByRole("navigation").boundingBox();
  expect((tabs?.y ?? 0) + (tabs?.height ?? 0)).toBe(844);
  const heights = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    page: document.querySelector("main")?.scrollHeight ?? 0,
  }));
  expect(heights.document).toBe(844);
  expect(heights.page).toBeGreaterThan(844);
});

test("shows board B3's loading shape while the profile comes", async ({ page, request }) => {
  await signIn(page, request);
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

test("takes an address and its access notes, and shows them", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByText("No address yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("House, flat or building").fill("House 4417, Tower C");
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
test("finds a building, keeps the flat separately, and shows the address as written", async ({ page, request }) => {
  await loggedIn(page, request);
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
  await expect(page.getByLabel("House, flat or building")).toBeHidden();
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Flat 1203, 12, Tower C, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Near Opposite the sector market")).toBeVisible();
});

test("the suggestion list works by keyboard alone", async ({ page, request }) => {
  await loggedIn(page, request);
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

test("an address can still be typed when the search gives nothing", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();

  // The stub answers this query with a 503, as a spent quota or an outage would.
  const search = page.getByRole("combobox", { name: "Search for your building" });
  await search.fill("mm-stub:down");
  await expect(page.getByText("Search is unavailable just now. Type your address below instead.")).toBeVisible();
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

test("refuses an address without a six-digit pincode", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("House, flat or building").fill("House 1");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("1220");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Fill in the house, the area, the city and a six-digit pincode.");
});

test("lists the five consents off, and switches one on with its date and off again", async ({ page, request }) => {
  await loggedIn(page, request);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(5);
  for (const name of [
    "Photographs for your own record",
    "Photographs on referral cards",
    "Photographs in our marketing",
    "WhatsApp about your visits",
    "WhatsApp about launches",
  ]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
  }

  const visits = page.getByRole("switch", { name: "WhatsApp about your visits" });
  await visits.click();
  await expect(visits).toHaveAttribute("aria-checked", "true");
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
});

test("shows the referral card's lines, and the naming line, before that consent can be switched on", async ({
  page,
  request,
}) => {
  await loggedIn(page, request);
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

test("changes the number: a code to each, then it waits for us", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("textbox", { name: "New number" }).fill(randomMobile());
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByText("Enter the code sent to each number.")).toBeVisible();
  await page.getByLabel("Code sent to your current number").fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  await page.getByRole("button", { name: "Check the codes" }).click();
  await expect(
    page.getByText(/^We will confirm the change to \+91 \d{2}xxx x\d{4} with you, then it takes effect\.$/),
  ).toBeVisible();
});

test("refuses the client's own number as the new one", async ({ page, request }) => {
  const mobile = await loggedIn(page, request);
  await page.getByRole("textbox", { name: "New number" }).fill(mobile);
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a ten-digit mobile number, not the one you use now.");
});

test("offers support on WhatsApp, with the design's line", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/919007973247",
  );
  await expect(page.getByText("Replies within a working day. Everything in writing.")).toBeVisible();
});

test("Your data: a download of everything held, and a concern sent to ops", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/me/export");
  await page.getByRole("button", { name: "Raise a concern" }).click();
  await page.getByRole("textbox", { name: "Your concern" }).fill("Please explain who sees my photographs.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Received. We answer within 30 days, on WhatsApp.")).toBeVisible();
});

test("asks before requesting deletion, then says it is requested", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(
    page.getByText("Photographs deleted within seven days. Invoices kept eight years, by law."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Keep my account" }).click();
  await expect(page.getByRole("button", { name: "Request deletion" })).toBeVisible();

  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Yes, request deletion" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toHaveText(
    /^Deletion requested on \d{1,2} [A-Z][a-z]{2} \d{4}\. We will confirm on WhatsApp\.$/,
  );
});

test("logs out from the foot of the profile", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

test("meets WCAG 2.2 AA, with the address form and the card's lines open", async ({ page, request }) => {
  await loggedIn(page, request);
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
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
