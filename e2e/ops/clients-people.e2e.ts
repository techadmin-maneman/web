// A client's page as the People screens draw it (docs/decisions/0306-the-people-screens-to-the-22-november-redesign.md):
// the Care person in its head, their stage on the journey beneath it (docs/decisions/0307-the-people-rulings.md), alerts
// and notes added from their cards' heads, and the clients recently opened.
// Every name and number here is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { CLIENT, fails, json, NEW_RECORD, RECORD, type OpsReply } from "./fixtures.ts";
import { NAME, openClient, READ_RECORD } from "./clients-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const words = opsCopy.clients;

type Chat = OpsReply<"/api/conversations">["conversations"][number];

/** Their chat with Care, which Priya looks after. */
const CHAT: Chat = {
  id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
  person: { id: CLIENT.id, name: CLIENT.name },
  mobile: "+919810004417",
  state: "open",
  care_person: "priya@maneman.in",
  care_name: "Priya",
  covered_by: null,
  technician: null,
  last_message_at: "2027-09-21T05:12:00.000Z",
  last_line: "Can I move my visit?",
  waiting_since: "2027-09-21T05:12:00.000Z",
  reply_by: "2027-09-21T06:12:00.000Z",
};

/** Someone who may read a client's page, its alerts and its notes, and change none of them nor read the chats. */
const READING_ONLY = json({
  signed_in_as: "view@maneman.in",
  sign_out: "/cdn-cgi/access/logout",
  cities: [],
  every_city: true,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "view", geography: "national", place: null }],
    may_call: [
      "GET /api/health",
      "GET /api/whoami",
      "POST /api/clients/find",
      "GET /api/clients/{id}",
      "GET /api/clients/{id}/alerts",
      "GET /api/clients/{id}/notes",
    ],
  },
} satisfies OpsReply<"/api/whoami">);

const card = (page: Page, title: string) => page.getByRole("region", { name: title });

test("names the client's Care person in the head, and reads no chats for someone who may not", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    "GET /api/conversations": json({ conversations: [CHAT], next_cursor: null }),
  });
  await expect(page.getByText(words.head.care("Priya"))).toBeVisible();
});

test("says nothing of a Care person, and asks for no chats, where the person's access does not reach them", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/conversations") asked.push(request.url());
  });
  await openClient(page, `/clients/${CLIENT.id}/visits`, { "GET /api/whoami": READING_ONLY });
  await expect(page.getByRole("heading", NAME)).toBeVisible();
  await expect(card(page, words.notes.title)).toBeVisible();
  await expect(page.getByText(/^Care: /)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("offers Add on alerts and notes only to those who may write them", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { "GET /api/whoami": READING_ONLY });
  await expect(card(page, words.alerts.title)).toContainText(words.alerts.none);
  await expect(card(page, words.notes.title)).toContainText(words.notes.none);
  await expect(page.getByRole("button", { name: words.alerts.add })).toHaveCount(0);
  await expect(page.getByRole("button", { name: words.notes.add })).toHaveCount(0);
});

test("keeps an alert's drawer open with the reason when it is refused, and says nothing was added", async ({
  page,
}) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    "POST /api/clients/{id}/alerts": fails(400, "invalid_request", ["body"]),
  });
  await page.getByRole("button", { name: words.alerts.add }).click();
  const drawer = page.getByRole("dialog", { name: words.alerts.formTitle });
  await drawer.getByRole("button", { name: words.alerts.save }).click();
  await expect(drawer.getByText(words.alerts.errors.invalid_request).first()).toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(page.getByText(words.alerts.added)).toHaveCount(0);
});

test("keeps a note's drawer open with the reason when it is refused, and says nothing was added", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    "POST /api/clients/{id}/notes": fails(400, "invalid_request", ["body"]),
  });
  await page.getByRole("button", { name: words.notes.add }).click();
  const drawer = page.getByRole("dialog", { name: words.notes.formTitle });
  await drawer.getByRole("button", { name: words.notes.addNote }).click();
  await expect(drawer.getByText(words.notes.errors.invalid_request).first()).toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(page.getByText(words.notes.added)).toHaveCount(0);
});

// A client kept with a stage the page does not know is left out of the strip, not drawn with a blank pill.
test("leaves out of the recently opened a client kept with a stage it does not know", async ({ page }) => {
  await page.addInitScript(
    ([kept]) => {
      sessionStorage.setItem("ops.recent-clients", kept);
    },
    [
      JSON.stringify([
        { id: "22000000-0000-4000-8000-000000000099", name: "Kabir Anand", stage: "unheard_of" },
        { id: CLIENT.id, name: CLIENT.name, stage: "active" },
      ]),
    ] as const,
  );
  await page.goto("/clients");
  const recent = page.getByRole("region", { name: words.find.recent });
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link")).toContainText(CLIENT.name);
});

test("says why a note changed in place to nothing is refused, keeping it open", async ({ page }) => {
  const note = {
    id: "5c000000-0000-4000-8000-000000000001",
    body: "Prefers early mornings.",
    written_by: "priya@maneman.in",
    written_at: "2027-09-19T05:00:00.000Z",
  };
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    "GET /api/clients/{id}/notes": json({ notes: [note] }),
    "POST /api/clients/{id}/notes": fails(400, "invalid_request", ["body"]),
  });
  const notes = card(page, words.notes.title);
  await notes.getByRole("button", { name: words.notes.change }).click();
  await notes.getByLabel(words.notes.label, { exact: true }).fill("");
  await notes.getByRole("button", { name: words.notes.save }).click();
  await expect(notes.getByText(words.notes.errors.body)).toBeVisible();
  await expect(notes.getByLabel(words.notes.label, { exact: true })).toBeVisible();
});

test("marks the client's stage on the journey beneath the head, from lead to active", async ({ page }) => {
  const journey = page.getByRole("list", { name: words.journey.label });
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json({ ...RECORD, stage: "consulted" }) });
  await expect(journey.getByRole("listitem")).toHaveText(Object.values(words.journey.steps));
  await expect(journey.locator("[aria-current=step]")).toHaveText(words.journey.steps.consulted);

  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(journey.locator("[aria-current=step]")).toHaveText(words.journey.steps.lead);
});
