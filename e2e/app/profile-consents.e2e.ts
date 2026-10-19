import { expect, randomMobile, test } from "../support.ts";
import { holdOpen } from "./one-tap.ts";
import { CODE } from "./signed-in.ts";
import { loggedIn } from "./profile-fixtures.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { CLIENT_WORDS } from "../../packages/web-kit/client-words.ts";

test("lists the four consents off, and switches one on with its date and off again", async ({ page }) => {
  await loggedIn(page);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(4);
  // Every visit is photographed for the client's record: a line, not a switch.
  await expect(page.getByText(appCopy.profile.visitPhotos)).toBeVisible();
  for (const name of [
    "Photographs on referral cards",
    "Photographs in our marketing",
    "WhatsApp about your visits",
    "WhatsApp about launches",
  ]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
  }
  // Visit messages off, the client is told what that means.
  const visitsOff = page.getByText(appCopy.profile.visitsOff);
  await expect(visitsOff).toBeVisible();

  const visits = page.getByRole("switch", { name: appCopy.profile.purposes.whatsapp_visits });
  const switched = page.waitForRequest("**/api/consents/whatsapp_visits");
  await visits.click();
  await expect(visits).toHaveAttribute("aria-checked", "true");
  await expect(visitsOff).toHaveCount(0);
  // Kept as given in the profile (docs/decisions/0094-where-a-consent-was-given.md).
  expect((await switched).postDataJSON()).toEqual({ granted: true, source: "app_profile" });
  await expect(page.getByText(/^Given \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: appCopy.profile.purposes.whatsapp_visits })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("switch", { name: appCopy.profile.purposes.whatsapp_visits }).click();
  await expect(page.getByRole("switch", { name: appCopy.profile.purposes.whatsapp_visits })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(visitsOff).toBeVisible();
});

// It showed five lines; one now says it, the naming among it, with the rest of the notice a tap away.
test("shows the referral card’s line, which names the referrer, before that consent can be switched on", async ({
  page,
}) => {
  await loggedIn(page);
  const cards = page.getByRole("switch", { name: appCopy.profile.purposes.photos_referral_cards });
  await cards.click();
  await expect(page.getByText(appCopy.profile.referralCards.line)).toBeVisible();
  await expect(page.getByRole("link", { name: CLIENT_WORDS.noticeMore }).last()).toHaveAttribute(
    "href",
    /\/notices#photos$/,
  );
  await page.getByRole("button", { name: appCopy.profile.referralCards.cancel }).click();
  await expect(cards).toHaveAttribute("aria-checked", "false");

  await cards.click();
  await page.getByRole("button", { name: appCopy.profile.referralCards.confirm }).click();
  await expect(cards).toHaveAttribute("aria-checked", "true");
});

test("changes the number: a code to each, then it waits for us", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("textbox", { name: appCopy.profile.change.newNumber }).fill(randomMobile());
  await page.getByRole("button", { name: appCopy.profile.change.start }).click();
  await expect(page.getByText(appCopy.profile.change.codes)).toBeVisible();
  await page.getByLabel(appCopy.profile.change.oldCode).fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  await page.getByRole("button", { name: appCopy.profile.change.check }).click();
  await expect(
    page.getByText(/^We’ll confirm the change to \+91 \d{2}xxx x\d{4} with you, then it takes effect\.$/),
  ).toBeVisible();

  // Until we decide it, the client can take it back, and start afresh.
  await page.getByRole("button", { name: appCopy.profile.change.withdraw }).click();
  await expect(page.getByRole("button", { name: appCopy.profile.change.start })).toBeVisible();
  await expect(page.getByText(/^We will confirm the change/)).toHaveCount(0);
});

// A switch the API did not answer stays as it was, and says so: a switch that looks off while the consent stands
// would tell the client something untrue about their data.
test("a consent that did not go through says so, and the switch stays as it was", async ({ page }) => {
  await loggedIn(page);
  await page.route("**/api/consents/*", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "test" } } }),
  );
  const visits = page.getByRole("switch", { name: appCopy.profile.purposes.whatsapp_visits });
  await visits.click();
  await expect(page.getByRole("alert")).toHaveText(appCopy.profile.switchFailed);
  await expect(visits).toHaveAttribute("aria-checked", "false");
});

test("a deletion request that did not go through says so, and asks again", async ({ page }) => {
  await loggedIn(page);
  await page.route("**/api/deletion-request", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "test" } } }),
  );
  await page.getByRole("button", { name: appCopy.profile.deletion.request }).click();
  await page.getByRole("button", { name: appCopy.profile.deletion.yes }).click();
  await expect(page.getByRole("alert")).toHaveText(appCopy.profile.deletion.failed);
  await expect(page.getByRole("button", { name: appCopy.profile.deletion.yes })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toHaveCount(0);
});

test("starts one number change, and checks the codes once, however often each is tapped", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("textbox", { name: appCopy.profile.change.newNumber }).fill(randomMobile());

  // Starting again withdraws the request just made and sends a fresh pair: four codes for one intent.
  const starts = await holdOpen(page, "**/api/number-change");
  const start = page.getByRole("button", { name: appCopy.profile.change.start });
  await start.click();
  const startLive = await start.isEnabled();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await start.click({ force: true });
  await expect(page.getByText(appCopy.profile.change.codes)).toBeVisible();

  await page.getByLabel(appCopy.profile.change.oldCode).fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  // One tap checks both numbers, one after the other, so two requests are one intent and four are two.
  const checks = await holdOpen(page, "**/api/number-change/verify");
  const check = page.getByRole("button", { name: appCopy.profile.change.check });
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
  await page.getByRole("button", { name: appCopy.profile.addAddress }).click();
  const search = page.getByRole("combobox", { name: appCopy.profile.form.building.label });
  await search.fill("Sunrise");
  await page.getByRole("option").first().click();
  await page.getByLabel(appCopy.profile.form.flat).fill("Flat 1203");
  await page.getByLabel(appCopy.profile.form.locality).fill("Sector 65");
  await page.getByLabel(appCopy.profile.form.city).fill("Gurgaon");
  await page.getByLabel(appCopy.profile.form.pincode).fill("122018");

  // A second save sends the search's session token again, and Google bills a second Place Details
  // resolution against a session that was meant to close once (ADR 0054).
  const held = await holdOpen(page, "**/api/profile/address");
  const save = page.getByRole("button", { name: appCopy.profile.form.save });
  await save.click();
  const liveWhileBusy = await save.isEnabled();
  await save.click({ force: true });

  await expect(page.getByText("Flat 1203, Sunrise Greens, Sector 65, Gurgaon 122018")).toBeVisible();
  expect({ asked: held.asked(), liveWhileBusy }).toEqual({ asked: 1, liveWhileBusy: false });
});

test("raises one grievance when Send is tapped twice", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: appCopy.profile.data.raise }).click();
  await page.getByRole("textbox", { name: appCopy.profile.data.field }).fill("Please explain who sees my photographs.");

  // Every grievance ops see carries its own answer-time clock, so two rows would be one client's
  // one concern counted twice against a regulated 30 days (docs/decisions/0049-dpdp.md).
  const held = await holdOpen(page, "**/api/grievances");
  const send = page.getByRole("button", { name: appCopy.profile.data.send });
  await send.click();
  const liveWhileBusy = await send.isEnabled();
  await send.click({ force: true });

  await expect(page.getByText(appCopy.profile.data.sent)).toBeVisible();
  expect({ asked: held.asked(), liveWhileBusy }).toEqual({ asked: 1, liveWhileBusy: false });
});

test("refuses the client’s own number as the new one", async ({ page }) => {
  const mobile = await loggedIn(page);
  await page.getByRole("textbox", { name: appCopy.profile.change.newNumber }).fill(mobile);
  await page.getByRole("button", { name: appCopy.profile.change.start }).click();
  await expect(page.getByRole("alert")).toHaveText(appCopy.profile.change.invalid);
});
