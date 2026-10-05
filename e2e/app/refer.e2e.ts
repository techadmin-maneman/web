// Refer in the app (boards F1 to F6) for the fitted client of e2e/app/fitted.ts, against the local mm-api. The
// client has no credits and nobody fitted yet, so this covers the invite, the card choice, the preview and the
// empty tracker; the grant itself is covered in the worker tests.
//
// The share sheet is the phone's, which no desktop browser here has: the tests that share stand one in before the
// app loads (stubShareSheet), taking files or not, as a phone's does.

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { expect, outsideContract, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { holdOpen } from "./one-tap.ts";
import { logIn, signIn } from "./signed-in.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** What the stand-in share sheet was given: each file as its name, type and size, and the words. */
interface Shared {
  readonly files: readonly { readonly name: string; readonly type: string; readonly size: number }[];
  readonly text: string | undefined;
}

/**
 * A phone's share sheet, stood in before the app loads. With `files` it takes JPEGs (canShare); without, it has no
 * canShare at all, as a phone that shares words only. Each share is kept, unless a refusal is waiting (refuseNext).
 */
async function stubShareSheet(page: Page, files: boolean): Promise<void> {
  await page.addInitScript((takesFiles: boolean) => {
    const shared: Shared[] = [];
    const refusals: string[] = [];
    Object.assign(window, { shared, refusals });
    if (takesFiles) {
      Object.defineProperty(Navigator.prototype, "canShare", {
        configurable: true,
        value: (data?: ShareData) => (data?.files ?? []).every((file) => file.type === "image/jpeg"),
      });
    } else {
      Reflect.deleteProperty(Navigator.prototype, "canShare");
    }
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data?: ShareData) => {
        const refusal = refusals.shift();
        if (refusal !== undefined) return Promise.reject(new DOMException("Not shared.", refusal));
        const kept = (data?.files ?? []).map((file) => ({ name: file.name, type: file.type, size: file.size }));
        shared.push({ files: kept, text: data?.text });
        return Promise.resolve();
      },
    });
  }, files);
}

/** Every share the stand-in sheet has taken. */
const sharedSoFar = (page: Page) => page.evaluate(() => (window as unknown as { shared: Shared[] }).shared);

/** The next share is refused with a DOMException of this name, as a phone refuses one or the client backs out. */
const refuseNext = (page: Page, name: "NotAllowedError" | "AbortError") =>
  page.evaluate((refusal) => {
    (window as unknown as { refusals: string[] }).refusals.push(refusal);
  }, name);

/** The house card as the app bundles it (scripts/build/make-house-card.ts). */
const HOUSE_CARD = readFileSync("apps/app/src/refer/invite-house.jpg");

/** The invite's own card sent as a photograph, with the invite's words as its caption. */
const cardWithInvite = (size: number) => ({
  files: [{ name: "mane-man-invite.jpg", type: "image/jpeg", size }],
  text: expect.stringMatching(/Worth a look: .*\/r\/[A-Z0-9]{8}$/) as unknown as string,
});

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
};

async function toRefer(page: Page) {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refer" })).toBeVisible();
}

test("Refer: the invite, the house card, the preview, and the empty tracker", async ({ page }) => {
  await toRefer(page);
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 free service visits.")).toBeVisible();
  // "No other discount applies", which the owner's ruling of 1 October undid.
  await expect(page.getByText(/discount/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await expect(
    sheet.getByText("Pick the picture your friend sees. Your name and message go with it, never on it."),
  ).toBeVisible();
  await scan(page);
  await sheet.getByRole("radio", { name: /A Mane Man example/ }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();

  // Board F4: the chat's bubble, exactly as the friend will see it, with the house card itself in it.
  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview.getByText("You have a Mane Man invite")).toBeVisible();
  await expect(
    preview.getByText(/Got my hair system fitted at home by Mane Man\. Worth a look: .*\/r\/[A-Z0-9]{8}/),
  ).toBeVisible();
  await expect(preview.locator("img").first()).toHaveAttribute("src", /invite-house/);
  await expect(preview.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await preview.getByRole("button", { name: "Copy link" }).click();
  await expect(preview.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/r\/[A-Z0-9]{8}$/);
  await scan(page);

  await preview.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "See who has been fitted" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Who has been fitted" })).toBeVisible();
  await expect(page.getByText("Nobody you have referred has been fitted yet.")).toBeVisible();
  await scan(page);

  // Board F6: the empty tracker is not a dead end.
  await page.getByRole("button", { name: "Share an invite" }).click();
  await expect(page.getByRole("dialog", { name: "Which card?" })).toBeVisible();
});

// Board F6's "Share failed": a way to share that fails, not one the client backs out of, says nothing was sent.
test("says when the link could not be shared, and tries again", async ({ page }) => {
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /A Mane Man example/ }).click();
  await page.getByRole("button", { name: "Continue to share" }).click();
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    let refused = false;
    navigator.clipboard.writeText = (text: string) => {
      if (refused) return writeText(text);
      refused = true;
      return Promise.reject(new DOMException("The page may not write to the clipboard.", "NotAllowedError"));
    };
  });
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("alert")).toContainText("The link didn’t generate. Nothing was sent.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

/** From Refer to the preview (F4) with the house example chosen. */
async function toTheExample(page: Page) {
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /A Mane Man example/ }).click();
  await page.getByRole("button", { name: "Continue to share" }).click();
  return page.getByRole("dialog", { name: "Preview · what your friend sees" });
}

// The owner's invites reached WhatsApp with no image: the app sent only words and a link, and the chat's preview
// of the link is all a friend could see. Where the phone can, the card itself goes, captioned with the invite.
test("sends the house card itself, captioned with the invite, where the phone shares files", async ({ page }) => {
  await stubShareSheet(page, true);
  const preview = await toTheExample(page);

  await preview.getByRole("link", { name: "WhatsApp" }).click();
  await expect.poll(() => sharedSoFar(page)).toEqual([cardWithInvite(HOUSE_CARD.byteLength)]);
  // The share sheet took it: WhatsApp's link was not followed as well.
  expect(page.context().pages()).toHaveLength(1);

  await preview.getByRole("button", { name: "Other apps" }).click();
  await expect.poll(() => sharedSoFar(page)).toHaveLength(2);
  expect((await sharedSoFar(page))[1]).toEqual(cardWithInvite(HOUSE_CARD.byteLength));
  await expect(preview.getByRole("alert")).toHaveCount(0);
});

test("keeps WhatsApp's link, with the words alone, where the phone shares no files", async ({ page }) => {
  await stubShareSheet(page, false);
  await page.context().route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "" }));
  const preview = await toTheExample(page);

  const whatsapp = preview.getByRole("link", { name: "WhatsApp" });
  await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  // The link opens with no opener (rel="noopener"), so the context sees the new tab, not this page.
  const opening = page.context().waitForEvent("page");
  await whatsapp.click();
  const opened = await opening;
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/^https:\/\/wa\.me\/\?text=Got%20my%20hair.*%2Fr%2F[A-Z0-9]{8}$/);

  await preview.getByRole("button", { name: "Other apps" }).click();
  await expect
    .poll(() => sharedSoFar(page))
    .toEqual([{ files: [], text: expect.stringMatching(/\/r\/[A-Z0-9]{8}$/) as unknown as string }]);
});

// A client who made their card earlier sees it, and sends it: the preview's own route answers only on the public
// host, so the app reads the card from its own (GET /api/refer/card). The shared client has none, so it is answered.
test("shows a client's stored card in the preview, and sends that card", async ({ page }) => {
  const card = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#1a2740" } })
    .jpeg()
    .toBuffer();
  // Only the browser resolves app.localhost, so the invite is fetched from the app's server by its address.
  await page.route(
    (url) => url.pathname === "/api/refer",
    async (route) => {
      const response = await route.fetch({
        url: `http://127.0.0.1:${String(PORTS.app)}/api/refer`,
        headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
      });
      const refer = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...refer, card: { state: "personal", version: 7, consented: true } } });
    },
  );
  const asked: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/refer/card",
    (route) => {
      asked.push(`${route.request().method()} ${new URL(route.request().url()).search}`);
      return route.fulfill({ body: card, contentType: "image/jpeg" });
    },
  );
  await stubShareSheet(page, true);

  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  const theirOwn = page.getByRole("radio", { name: /My before and after/ });
  await expect(theirOwn).toBeChecked();
  // The two cards are native radio buttons, which the arrow keys move between.
  await theirOwn.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /A Mane Man example/ })).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(theirOwn).toBeChecked();
  await page.getByRole("button", { name: "Continue to share" }).click();

  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  const image = preview.locator("img").first();
  await expect(image).toHaveAttribute("src", "/api/refer/card?v=7");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1200);
  await preview.getByRole("link", { name: "WhatsApp" }).click();
  await expect.poll(() => sharedSoFar(page)).toEqual([cardWithInvite(card.byteLength)]);
  expect([...new Set(asked)]).toEqual(["GET ?v=7"]);
});

// Board F6's "Share failed" is for a share that failed, not one the client backed out of.
test("says when the phone refused the card's share, and nothing when the client backed out", async ({ page }) => {
  await stubShareSheet(page, true);
  const preview = await toTheExample(page);
  const whatsapp = preview.getByRole("link", { name: "WhatsApp" });

  await refuseNext(page, "NotAllowedError");
  await whatsapp.click();
  const failed = preview.getByRole("alert");
  await expect(failed).toContainText("Share failed");
  await expect(failed).toContainText("The link didn’t generate. Nothing was sent.");
  await preview.getByRole("button", { name: "Try again" }).click();
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => sharedSoFar(page)).toEqual([cardWithInvite(HOUSE_CARD.byteLength)]);

  await refuseNext(page, "AbortError");
  await whatsapp.click();
  // The tap takes the refusal; by the second frame after it the sheet has drawn whatever it made of it.
  await expect.poll(() => page.evaluate(() => (window as unknown as { refusals: string[] }).refusals)).toEqual([]);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(preview.getByRole("alert")).toHaveCount(0);
  expect(await sharedSoFar(page)).toHaveLength(1);
});

// Their own card was offered with no first-fit photographs to make it
// of, and ended in an error. This client's first fit has an after photograph and no before (e2e/app/fitted.ts).
test("offers their own card only once the first fit's photographs are in", async ({ page }) => {
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await expect(sheet.getByText("Your own before and after appears once your first-fit photos are in.")).toBeVisible();
  await expect(sheet.getByRole("radio")).toHaveCount(1);
  await expect(sheet.getByRole("radio", { name: /A Mane Man example/ })).toBeChecked();
  await scan(page);
});

/** The first fit's front photographs, before and after, answered here at these links. */
async function firstFitPair(page: Page, before: string, after: string) {
  const front = (url: string) => ({ angle: "front", url, thumbnail_url: null, width: 600, height: 800 });
  await page.route("**/api/photos", (route) =>
    route.fulfill({
      json: {
        visits: [
          {
            visit_id: fittedClient().firstFit.id,
            date: fittedClient().firstFit.date,
            type: "first_fit",
            photos: { before: [front(before)], after: [front(after)] },
          },
        ],
        try_ons: [],
      },
    }),
  );
}

// "Without consent, the first option opens F3 instead of selecting." And nothing is agreed to for a card the
// phone could not make: here the first fit's photographs cannot be read.
test("asks for the consent before choosing their own card, and records none when the card cannot be made", async ({
  page,
}) => {
  await firstFitPair(page, "/e2e/unreadable-before.jpg", "/e2e/unreadable-after.jpg");
  // The photographs fetched to build the card are held until both taps are in, so the second lands mid-build.
  const building = Promise.withResolvers<undefined>();
  await page.route("**/e2e/unreadable-*.jpg", async (route) => {
    if (route.request().resourceType() === "fetch") await building.promise;
    await route.fulfill({ status: 404 });
  });
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /My before and after/ }).click();
  await expect(page.getByRole("heading", { name: "Before you send your own photos" })).toBeVisible();
  await expect(page.getByText("Your first name appears on your invite.")).toBeVisible();

  const consents = await holdOpen(page, "**/api/consents/*");
  // A card is built from the photographs fetched for it, apart from those the card's drawing shows.
  let builds = 0;
  page.on("request", (sent) => {
    if (sent.resourceType() === "fetch" && sent.url().endsWith("/e2e/unreadable-before.jpg")) builds += 1;
  });
  const allow = page.getByRole("button", { name: "Allow for referral cards" });
  await allow.click();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await allow.click({ force: true });
  building.resolve(undefined);

  await expect(page.getByRole("heading", { name: "Preview · what your friend sees" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("We couldn’t make your card, so we’ve used our example instead.");
  expect({ consents: consents.asked(), builds }).toEqual({ consents: 0, builds: 1 });
});

// The whole of their own card: composed in a Worker from the two front photographs, then the consent recorded,
// then the card stored, once each however often Allow is tapped. The photographs and the store are answered here,
// so the shared client is left with the house card.
test("makes their own card, records one consent and stores one card, when Allow is tapped twice", async ({ page }) => {
  const block = async (background: string) =>
    sharp({ create: { width: 600, height: 800, channels: 3, background } })
      .jpeg()
      .toBuffer();
  const [before, after] = await Promise.all([block("#131c2e"), block("#1a2740")]);
  await firstFitPair(page, "/e2e/before.jpg", "/e2e/after.jpg");
  await page.route("**/e2e/before.jpg", (route) => route.fulfill({ body: before, contentType: "image/jpeg" }));
  await page.route("**/e2e/after.jpg", (route) => route.fulfill({ body: after, contentType: "image/jpeg" }));
  const stored: number[] = [];
  await page.route("**/api/refer/card", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    stored.push(route.request().postDataBuffer()?.byteLength ?? 0);
    return route.fulfill({ json: { version: 2 } });
  });
  // The consent itself is answered here too, so the shared client is not left agreeing to anything. The card is
  // composed before it is asked for, so a second tap lands while the first is still at work.
  let consents = 0;
  const sent: unknown[] = [];
  await page.route("**/api/consents/*", (route) => {
    consents += 1;
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      json: { purpose: "photos_referral_cards", granted: true, since: new Date().toISOString() },
    });
  });
  await stubShareSheet(page, true);

  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /My before and after/ }).click();
  const allow = page.getByRole("button", { name: "Allow for referral cards" });
  await allow.click();
  await allow.click({ force: true });

  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview.locator("img").first()).toHaveAttribute("src", /^blob:/);
  expect({ consents, stored: stored.length }).toEqual({ consents: 1, stored: 1 });
  // Kept as given on the share sheet (docs/decisions/0094-where-a-consent-was-given.md).
  expect(sent).toEqual([{ granted: true, source: "app_share_sheet" }]);
  // A JPEG, and under the 300 KB WhatsApp takes.
  expect(stored[0]).toBeGreaterThan(0);
  expect(stored[0]).toBeLessThan(300 * 1024);

  // The card just made is the one sent, kept as it was made: the page may not fetch its own blob: link.
  await preview.getByRole("link", { name: "WhatsApp" }).click();
  await expect.poll(() => sharedSoFar(page)).toEqual([cardWithInvite(stored[0] ?? 0)]);
});

/**
 * One of the local mm-api's answers on the app's host, with `change` made to it. Only the browser resolves
 * app.localhost, so the answer is fetched from the app's server by its address, on the app's own host.
 */
async function changed(page: Page, path: string, change: (answer: Record<string, unknown>) => unknown) {
  await page.route(`**${path}`, async (route) => {
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}${path}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    if (!answer.ok()) return route.fulfill({ response: answer });
    await route.fulfill({ response: answer, json: change((await answer.json()) as Record<string, unknown>) });
  });
}

// The owner's ruling of 1 October 2026: ops set each side's visits apart
// (docs/decisions/0107-referral-rewards-in-the-console.md).
test("says what ops set each side gets, and beside each friend what the client earned", async ({ page }) => {
  await changed(page, "/api/me", (me) => ({
    ...me,
    referral_reward: { referrer_visits: 2, friend_visits: 4, valid_days: 180 },
  }));
  await changed(page, "/api/refer", (refer) => ({
    ...refer,
    fitted: [
      { first_name: "Karan", month: "2026-09", visits: 2 },
      { first_name: "Vikram", month: "2026-08", visits: 0 },
    ],
  }));
  await toRefer(page);
  await expect(
    page.getByText("When a friend you refer is fitted, you get 2 free service visits, and your friend gets 4."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await sheet.getByRole("radio", { name: /A Mane Man example/ }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();
  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(
    preview.getByText("Home-fitted hair systems across Delhi NCR. 4 service visits free when you're fitted."),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "See who has been fitted" }).click();
  const friends = page.getByRole("listitem");
  await expect(friends.filter({ hasText: "Karan" })).toContainText("2 visits earned");
  await expect(friends.filter({ hasText: "Vikram" })).not.toContainText("earned");
  await expect(page.getByText("visits earned", { exact: true })).toBeVisible();
});

// The Home the service worker kept from before mm-api answered the reward, and an mm-api rolled back, carry none,
// nor each friend's visits (apps/app/src/refer/reward.ts): Refer still draws, and gives no count.
test("draws Refer, its preview and its tracker, with no count, where the answers carry no reward", async ({ page }) => {
  outsideContract("GET /api/me 200", "GET /api/refer 200");
  await changed(page, "/api/me", ({ referral_reward: _gone, ...me }) => me);
  await changed(page, "/api/refer", (refer) => ({ ...refer, fitted: [{ first_name: "Karan", month: "2026-09" }] }));
  await toRefer(page);
  await expect(page.getByText("When a friend you refer is fitted, we tell you.")).toBeVisible();

  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await sheet.getByRole("radio", { name: /A Mane Man example/ }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();
  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview.getByText("Home-fitted hair systems across Delhi NCR.", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "See who has been fitted" }).click();
  const karan = page.getByRole("listitem").filter({ hasText: "Karan" });
  await expect(karan).toContainText("Fitted Sep 2026");
  await expect(karan).not.toContainText("earned");
  await expect(page.getByText("NaN")).toHaveCount(0);
});

test("draws a lead's empty Refer, with no count, where the Home carries no reward", async ({ page }) => {
  outsideContract("GET /api/me 200");
  await changed(page, "/api/me", ({ referral_reward: _gone, ...me }) => me);
  await signIn(page);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByText("Your invite opens after your first fit.")).toBeVisible();
  await expect(page.getByText("When a friend you refer is fitted, we tell you.")).toBeVisible();
});

// Board B2: before their first fit a client has nothing to vouch for, and the invite's own words would not be
// true, so Refer is reachable but empty. It once
// told them that nobody they referred had been fitted.
test("a client not yet fitted sees Refer's empty state, with no invite to send", async ({ page }) => {
  await signIn(page);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByText("Your invite opens after your first fit.")).toBeVisible();
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 free service visits.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share an invite" })).toHaveCount(0);
  await scan(page);
});

// An invited friend was never reminded in the app of the visits the invite
// promised them.
test("a client not yet fitted who came with an invite is told what it gives them at their fit", async ({ page }) => {
  await changed(page, "/api/me", (me) => ({ ...me, pending_invite: { referrer_first_name: "Rohit" } }));
  await signIn(page);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByText("Rohit's invite: your 3 free service visits arrive when you're fitted.")).toBeVisible();
  await expect(page.getByText("Your own invite opens after your first fit.")).toBeVisible();
});
