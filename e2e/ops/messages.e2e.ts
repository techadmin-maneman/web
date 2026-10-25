// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md), which no board draws. Every name and number is
// made up.

import { indiaClock, indiaDate, shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { care as copy } from "../../apps/ops/src/content/care.ts";

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
      ],
    }),
  });
  await page.goto("/messages");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  const chat = page
    .getByRole("list", { name: copy.chats })
    .getByRole("button", { name: copy.openLabel("Arjun Mehta") });
  await expect(chat).toContainText("asha@maneman.test");
  await expect(chat).toContainText(ARJUN.last_line ?? "");
  const due = ARJUN.reply_by ?? "";
  await expect(chat).toContainText(copy.overdue(`${shortDate(indiaDate(due))}, ${indiaClock(due)}`));
  await expect(page.getByText(copy.choose)).toBeVisible();
  await chat.click();
  await expect(chat).toHaveAttribute("aria-current", "true");
  expect(await axeViolations(page)).toEqual([]);
  await expect(
    page.getByText(copy.thread.auto("Visit reminder", [copy.thread.delivered, copy.thread.read])),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: copy.thread.page })).toHaveAttribute(
    "href",
    `/clients/${ARJUN.person?.id ?? ""}/visits`,
  );
  await expect(page.getByText(`${copy.carePerson.label}: asha@maneman.test`)).toBeVisible();
});

test("names a Care person by the name clients know them by, once a manager has set one", async ({ page }) => {
  const named = { ...ARJUN, care_name: "Asha" };
  await answer(page, {
    "GET /api/conversations": json({ conversations: [named], next_cursor: null }),
    "GET /api/conversations/{id}": json({ conversation: named, items: [] }),
  });
  await page.goto("/messages");
  const chat = page.getByRole("button", { name: copy.openLabel("Arjun Mehta") });
  await expect(chat).toContainText("Asha");
  await chat.click();
  await expect(page.getByText(`${copy.carePerson.label}: Asha`)).toBeVisible();
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
  await expect(page.getByRole("button", { name: copy.openLabel("Arjun Mehta") })).toBeVisible();
  const neha: Conversation = {
    ...ARJUN,
    id: "c1000000-0000-4000-8000-000000000002",
    person: { id: "22000000-0000-4000-8000-000000000099", name: "Neha Kapoor" },
  };
  conversations = [neha, ARJUN];
  await page.clock.runFor(21_000);
  await expect(page.getByRole("status").filter({ hasText: copy.newChat("Neha Kapoor") })).toBeVisible();
});
