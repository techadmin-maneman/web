import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, fails, json, NEW_RECORD, PHOTOS, RECORD, type Call, type OpsReply } from "./fixtures.ts";
import { RECORD_PATH, READ_RECORD, READ_PHOTOS, VIEW_PHOTOS, openClient, invitedBy } from "./clients-fixtures.ts";

const ATTACH_INVITE: Call = `POST ${RECORD_PATH}/referral`;

const readPhoto = (id: string): Call => `GET ${RECORD_PATH}/photos/${id}`;

// A friend who booked away from the invite's page earned their referrer nothing until ops could attach it (ADR 0089).
test("says where the visits of the invite a client came with stand", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/referrals`);
  const invite = page.getByRole("region", { name: "Invite" });
  await expect(invite).toContainText("RewardGiven");
  await expect(invite).toContainText("Since20 Oct 2026");
  await expect(invite.getByText("Attached by")).toHaveCount(0);
  await expect(invite.getByRole("button", { name: "Attach invite" })).toHaveCount(0);
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
  await expect(invite).toContainText("No invite.");
  // The note forbade a fitted client, though one is allowed, held for review.
  await expect(invite).toContainText("After a first fit, it's held for review.");
  const attach = invite.getByRole("button", { name: "Attach invite" });
  await expect(attach).toBeDisabled();

  await invite.getByLabel("Invite code").fill("rm4k7p");
  await expect(attach).toBeDisabled();
  await invite.getByLabel("Reason").fill("Told us Rohit sent him");
  expect(await axeViolations(page)).toEqual([]);
  const sent = page.waitForRequest((request) => request.url().endsWith("/referral") && request.method() === "POST");
  await attach.click();
  expect((await sent).postDataJSON()).toEqual({ code: "rm4k7p", reason: "Told us Rohit sent him" });

  await expect(invite.getByRole("status")).toHaveText("Invite attached.");
  // The head names who sent it as the API answered, without the record being read again.
  await expect(invitedBy(page)).toHaveText("Rohit Malhotra (RM4K7P)");
  await expect(invite).toContainText("RewardGiven once this client is fitted");
  await expect(invite).toContainText("Attached byops@maneman.in");
  await expect(invite).toContainText("ReasonTold us Rohit sent him");
});

test.describe("says why an invite was not attached", () => {
  for (const [code, words] of [
    ["unknown_invite", "No invite with that code."],
    ["own_invite", "That's their own invite."],
  ] as const) {
    test(code, async ({ page }) => {
      await openClient(page, `/clients/${CLIENT.id}/referrals`, {
        [READ_RECORD]: json(NEW_RECORD),
        [ATTACH_INVITE]: fails(code === "unknown_invite" ? 422 : 409, code),
      });
      const invite = page.getByRole("region", { name: "Invite" });
      await invite.getByLabel("Invite code").fill("RM4K7P");
      await invite.getByLabel("Reason").fill("Told us Rohit sent him");
      await invite.getByRole("button", { name: "Attach invite" }).click();
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
    await invite.getByLabel("Reason").fill("Told us Rohit sent him");
    await invite.getByRole("button", { name: "Attach invite" }).click();
    await expect(invite.getByRole("status")).toHaveText("Already attached.");
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
  await expect(page.getByRole("heading", { name: `Photos of ${CLIENT.name}` })).toBeVisible();
  // Why they are kept, whatever the Consents tab says.
  await expect(page.getByText("Taken at every visit for the record.")).toBeVisible();
  await expect(page.getByText("Opening these is logged with your name and the time.")).toBeVisible();
  // Nothing is fetched while it is locked, so nothing is logged.
  expect(asked).toBe(0);
  await expect(page.getByRole("img")).toHaveCount(0);
});

// One opening was ten entries in the log, and the time lettered was the browser's.
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
  await expect(page.getByRole("alert")).toContainText("Couldn't log the view, so photos stay locked.");
  await expect(page.getByRole("img")).toHaveCount(0);
  expect(photos).toBe(0);
});

test("shows no photograph the API would not serve", async ({ page }) => {
  const first = PHOTOS.visits[0]?.photos[0]?.id ?? "";
  await openClient(page, `/clients/${CLIENT.id}/photos`, {
    [readPhoto(first)]: fails(503, "unavailable"),
  });
  await page.getByRole("button", { name: "View photos" }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't log the view");
  await expect(page.getByRole("img")).toHaveCount(9);
});

// Every photograph of every visit was fetched at once.
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
