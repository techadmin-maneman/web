import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { logIn, signIn } from "./signed-in.ts";
import { loggedIn } from "./profile-fixtures.ts";

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
      "Received. We’ll reply here and on WhatsApp, usually within a working day and always within 30 days.",
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
