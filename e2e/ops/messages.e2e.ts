// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md), which no board draws. Every name and number is
// made up.

import type { Page } from "@playwright/test";
import { indiaClock, indiaDate, shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { care as copy } from "../../apps/ops/src/content/care.ts";
import { shell } from "../../apps/ops/src/content/shell.ts";

type Conversation = OpsReply<"/api/conversations">["conversations"][number];

const ARJUN: Conversation = {
  id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  mobile: "+919810000001",
  state: "open",
  care_person: "asha@maneman.test",
  care_name: null,
  covered_by: null,
  technician: null,
  last_message_at: "2026-09-21T05:12:00.000Z",
  last_line: "Can I move tomorrow’s visit to the evening?",
  waiting_since: "2026-09-21T05:12:00.000Z",
  reply_by: "2026-09-21T06:12:00.000Z",
};

/** A chat in the list, by who it is with. */
const chatRow = (page: Page, who: string) =>
  page.getByRole("list", { name: copy.chats }).getByRole("button", { name: new RegExp(`^${who}`) });

/** The Care person among the facts beside the chat open. */
const carePerson = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: copy.panel.title }).locator(`dt:text-is("${copy.carePerson.label}") + dd`);

test("lists the chats waiting on us, and opens one with our automatic messages in it", async ({ page }) => {
  await answer(page, {
    "GET /api/conversations": json({ conversations: [ARJUN], next_cursor: null }),
    "GET /api/care-team": json({
      team: [
        {
          email: "asha@maneman.test",
          on_team: true,
          name: "Asha",
          clients: 12,
          weekly_off: [0],
          leave: [],
          off_today: false,
          covered_by: null,
          on_shift_since: "2026-09-21T03:30:00.000Z",
          day_off: false,
          open_chats: 1,
        },
      ],
      me: "asha@maneman.test",
    }),
    "GET /api/conversations/{id}": json({
      conversation: ARJUN,
      items: [
        {
          kind: "auto",
          at: "2026-09-20T04:00:01.000Z",
          message: "visit_reminder",
          state: "sent",
          delivered_at: "2026-09-20T04:00:05.000Z",
          read_at: "2026-09-20T05:00:00.000Z",
        },
        { kind: "in", at: ARJUN.last_message_at, author: "client", text: ARJUN.last_line, delivery: null },
        // One WhatsApp refused after it was sent (docs/decisions/0276-a-message-whatsapp-refuses.md).
        {
          kind: "auto",
          at: "2026-09-21T06:00:01.000Z",
          message: "visit_cancelled",
          state: "failed",
          delivered_at: null,
          read_at: null,
        },
      ],
      close_reason: null,
      piece_report: null,
    }),
  });
  await page.goto("/messages");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  const chat = chatRow(page, "Arjun Mehta");
  await expect(chat).toContainText(ARJUN.last_line ?? "");
  await expect(page.getByText(copy.choose)).toBeVisible();
  await chat.click();
  await expect(chat).toHaveAttribute("aria-current", "true");
  // The chat's head says when our reply was due, the Care person is beside it with the client.
  const due = ARJUN.reply_by ?? "";
  await expect(page.getByRole("region", { name: copy.thread.title("Arjun Mehta") })).toContainText(
    copy.thread.replyBy(`${shortDate(indiaDate(due))}, ${indiaClock(due)}`),
  );
  // The client's name heads the chat and opens their page.
  await expect(
    page
      .getByRole("region", { name: copy.thread.title("Arjun Mehta") })
      .getByRole("heading")
      .getByRole("link", { name: "Arjun Mehta" }),
  ).toHaveAttribute("href", "/clients/11111111-1111-4111-8111-111111111111/visits");
  expect(await axeViolations(page)).toEqual([]);
  await expect(
    page.getByText(copy.thread.auto("Visit reminder", [copy.thread.delivered, copy.thread.read])),
  ).toBeVisible();
  await expect(page.getByText(copy.thread.auto("Visit cancelled", [copy.thread.notDelivered]))).toBeVisible();
  await expect(page.getByRole("link", { name: copy.panel.links.visits })).toHaveAttribute(
    "href",
    `/clients/${ARJUN.person?.id ?? ""}/visits`,
  );
  await expect(carePerson(page)).toHaveText("asha@maneman.test");
});

test("names a Care person by the name clients know them by, once a manager has set one", async ({ page }) => {
  const named = { ...ARJUN, care_name: "Asha" };
  await answer(page, {
    "GET /api/conversations": json({ conversations: [named], next_cursor: null }),
    "GET /api/conversations/{id}": json({ conversation: named, items: [], close_reason: null, piece_report: null }),
  });
  await page.goto("/messages");
  await chatRow(page, "Arjun Mehta").click();
  await expect(carePerson(page)).toHaveText("Asha");
});

// The panel beside a chat is a narrow column; every action in it is drawn as its icon, and stays a square in it.
test("keeps each of the client panel's icons a square, at a desk and on a phone", async ({ page }) => {
  await answer(page, {
    "GET /api/conversations": json({ conversations: [ARJUN], next_cursor: null }),
    "GET /api/conversations/{id}": json({ conversation: ARJUN, items: [], close_reason: null, piece_report: null }),
    "GET /api/conversations/{id}/report-photos": json({
      photos: [
        {
          report_id: "9a1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
          reference: "MM-ISS-0032",
          n: 1,
          at: "2026-09-20T04:00:00.000Z",
        },
      ],
    }),
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/messages");
    await chatRow(page, "Arjun Mehta").click();
    const panel = page.getByRole("complementary", { name: copy.panel.title });
    await expect(panel.getByRole("button", { name: copy.reportPhotos.show(1) })).toBeVisible();
    // The page links, free visits, a matter for the city, and the report's photographs.
    const icons = await panel
      .locator("[data-tip]")
      .evaluateAll((all) =>
        all.map((each) => each.getBoundingClientRect()).map(({ width, height }) => ({ width, height })),
      );
    expect(icons.length).toBeGreaterThanOrEqual(7);
    for (const icon of icons) expect(Math.abs(icon.width - icon.height)).toBeLessThanOrEqual(1);
  }
});

// Going on shift is a Care member's first act of the day, so it is under Messages, not only in Settings.
test("opens the Care team beside the chats, where a member goes on shift without Settings", async ({ page }) => {
  let sent: unknown = null;
  await answer(page, {
    "GET /api/conversations": json({ conversations: [ARJUN], next_cursor: null }),
    "GET /api/care-team": json({
      team: [
        {
          email: "asha@maneman.test",
          on_team: true,
          name: "Asha",
          clients: 12,
          weekly_off: [0],
          leave: [],
          off_today: false,
          covered_by: null,
          on_shift_since: null,
          day_off: false,
          open_chats: 1,
        },
      ],
      me: "asha@maneman.test",
    }),
    "POST /api/care-team/shift": (route) => {
      sent = route.request().postDataJSON();
      return json({ ok: true })(route);
    },
  });
  await page.goto("/messages");
  // The trail names Messages once, with nothing to follow back to the page it is on.
  const trail = page.getByRole("navigation", { name: shell.crumbs });
  await expect(trail).toHaveText(shell.nav.messages);
  await expect(trail.getByRole("link")).toHaveCount(0);
  await page.getByRole("link", { name: copy.team.title, exact: true }).click();
  await expect(page).toHaveURL(/\/care-team$/);
  await expect(trail.getByRole("link", { name: shell.nav.messages })).toHaveAttribute("href", "/messages");
  await expect(page.getByRole("heading", { level: 1, name: copy.team.title })).toBeVisible();
  await page.getByRole("button", { name: copy.team.goOn }).click();
  await expect.poll(() => sent).toEqual({ on: true });
});

// Four ways to search: Messages took a box and a Find; it now finds as it is typed.
test("finds a chat by the client's name as it is typed, with no Find to press", async ({ page }) => {
  await answer(page, {
    "GET /api/conversations": json({ conversations: [ARJUN], next_cursor: null }),
    "GET /api/care-team": json({ team: [], me: null }),
  });
  await page.goto("/messages");
  const asked = page.waitForRequest(
    (request) => request.url().includes("/api/conversations?") && request.url().includes("search=Arjun"),
  );
  await page.getByRole("searchbox", { name: copy.search }).fill("Arjun");
  await asked;
  await expect(page.getByRole("button", { name: copy.find, exact: true })).toHaveCount(0);
});

// A new chat came in silently: the list changed under ops' eyes with nothing to say so.
test("says so when a chat new to the list comes in as it reads itself again", async ({ page }) => {
  await page.clock.install();
  let conversations = [ARJUN];
  await answer(page, {
    "GET /api/conversations": (route) => json({ conversations, next_cursor: null })(route),
    "GET /api/care-team": json({ team: [], me: null }),
  });
  await page.goto("/messages");
  await expect(chatRow(page, "Arjun Mehta")).toBeVisible();
  const neha: Conversation = {
    ...ARJUN,
    id: "c1000000-0000-4000-8000-000000000002",
    person: { id: "22000000-0000-4000-8000-000000000099", name: "Neha Kapoor" },
  };
  conversations = [neha, ARJUN];
  await page.clock.runFor(21_000);
  await expect(page.getByRole("status").filter({ hasText: copy.newChat("Neha Kapoor") })).toBeVisible();
});

// A reply left the chat waiting on the client, so the list of those waiting on us, read again, no longer held it:
// the chat closed under Care's hands.
test("keeps a chat open when, read again, the list it was opened from no longer holds it", async ({ page }) => {
  await page.clock.install();
  let conversations = [ARJUN];
  await answer(page, {
    "GET /api/conversations": (route) => json({ conversations, next_cursor: null })(route),
    "GET /api/care-team": json({ team: [], me: null }),
    "GET /api/conversations/{id}": json({
      conversation: ARJUN,
      items: [{ kind: "in", at: ARJUN.last_message_at, author: "client", text: ARJUN.last_line, delivery: null }],
      close_reason: null,
      piece_report: null,
    }),
  });
  await page.goto("/messages");
  await chatRow(page, "Arjun Mehta").click();
  const chat = page.getByRole("region", { name: copy.thread.title("Arjun Mehta") });
  const line = ARJUN.last_line ?? "";
  await expect(chat.getByText(line)).toBeVisible();

  conversations = [];
  await page.clock.runFor(21_000);
  await expect(page.getByText(copy.none)).toBeVisible();
  await expect(chat.getByText(line)).toBeVisible();
});
