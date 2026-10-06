import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, CLIENT, CONSENTS, ERASURE_REQUESTED, json, type Call, type OpsReply } from "./fixtures.ts";
import { RECORD_PATH, READ_CONSENTS, NAME, openClient } from "./clients-fixtures.ts";

const ERASE: Call = `POST ${RECORD_PATH}/erasure`;

type ConsentSource = OpsReply<"/api/clients/{id}/consents">["consents"][number]["source"];

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
  expect(await axeViolations(page)).toEqual([]);
});

test("says when the client has asked to be erased, and leaves it to Deletion requests", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/consents`, {
    [READ_CONSENTS]: json(ERASURE_REQUESTED),
  });
  await expect(page.getByText("Deletion requested 18 Sep 2027. It is not decided here.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Erase ${CLIENT.name}` })).toHaveCount(0);
});

// The operators' erasure was a script with a shared secret, on the public host, that left no audit entry.
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
  await expect(erasing).toContainText("Cancel it on their Visits tab, which refunds what they paid, then erase.");
  await answer(page, { [ERASE]: json(ERASED) });
  const anyway = erasing.getByRole("button", { name: "Erase anyway" });
  await expect(anyway).toBeDisabled();
  await erasing.getByRole("checkbox", { name: "I will cancel and refund it by hand today." }).check();

  const sent = page.waitForRequest((request) => request.url().endsWith("/erasure") && request.method() === "POST");
  await anyway.click();
  expect((await sent).postDataJSON()).toEqual({ override_open_bookings: true });
  await expect(page.getByRole("heading", { name: "Erased" })).toBeVisible();
});
