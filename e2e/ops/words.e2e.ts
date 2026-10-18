// Growth · Words (docs/decisions/0126-the-words-page.md), which no board draws. A row opens the line's record, where
// its wording changes where it reads (docs/decisions/0212-editing-in-place.md). Every name is made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { EDITING, review } from "../../apps/ops/src/content/common.ts";
import { words as copy } from "../../apps/ops/src/content/words.ts";

type Word = OpsReply<"/api/words">["words"][number];

const REMINDER: Word = {
  key: "message:visit_reminder_v1",
  surface: "message",
  group: "Messages",
  where: "visit_reminder_v1",
  text: "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.",
  reviewed: true,
  now: "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.",
  changed: null,
  longest: 94,
  on_site: null,
};
const HERO: Word = {
  key: "site:home/hero.title",
  surface: "site",
  group: "Home",
  where: "hero",
  text: "A hair system, fitted at home.",
  reviewed: false,
  now: "Hair, fitted at home.",
  changed: { by: "growth@maneman.test", at: "2026-10-05T06:30:00.000Z" },
  longest: 50,
  on_site: false,
};
const FAQ: Word = {
  ...HERO,
  key: "site:home/faq.title",
  where: "faq",
  text: "Questions",
  now: "Questions",
  changed: null,
  longest: 29,
  on_site: true,
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await answer(page, {
    "GET /api/words": json({ words: [REMINDER, HERO, FAQ], published: null, messages: "at_once" }),
    "GET /api/words/history": json({ versions: [] }),
    ...extra,
  });
  await page.goto("/words");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const row = (page: Page, place: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: copy.open(place), exact: true }) });

async function recordOf(page: Page, place: string) {
  await page.getByRole("button", { name: copy.open(place), exact: true }).click();
  return page.getByRole("dialog", { name: place });
}

test("lists every line with the wording in force, who changed it, and whether the site has it", async ({ page }) => {
  await open(page);
  await expect(row(page, "Top of the page · Title").getByRole("cell").nth(1)).toHaveText(
    `Hair, fitted at home.Changed by growth@maneman.test, Mon 5 Oct${copy.notOnSite}${copy.review.notReviewed}`,
  );
  await expect(page.getByText(copy.publish.never)).toBeVisible();
  await expect(row(page, "Visit reminder")).toBeVisible();
});

test("changes a message where its wording reads, keeping its details", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/words": (route: Route) => {
      sent = route.request().postDataJSON();
      const now = (sent as { text: string }).text;
      return json({
        word: { ...REMINDER, now, changed: { by: "growth@maneman.test", at: "2026-10-11T06:30:00.000Z" } },
      })(route);
    },
  });
  const record = await recordOf(page, "Visit reminder");
  await expect(record.getByText(copy.form.keep("{{1}}, {{2}}, {{3}}, {{4}}, {{5}}"), { exact: false })).toBeVisible();
  await record.getByRole("button", { name: `${EDITING.change} ${copy.form.wording}` }).click();
  const reworded = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}.";
  await record.getByRole("textbox", { name: copy.form.wording }).fill(reworded);
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect(record.getByRole("status")).toHaveText(EDITING.saved);
  expect(sent).toEqual({ key: REMINDER.key, text: reworded });
  await expect(row(page, "Visit reminder")).toContainText("see you tomorrow.");
});

test("says why words are refused", async ({ page }) => {
  await open(page, {
    "POST /api/words": json(
      { error: { code: "invalid_request", fields: ["text.first_line"], request_id: "r-1" } },
      400,
    ),
  });
  const record = await recordOf(page, "Visit reminder");
  await record.getByRole("button", { name: `${EDITING.change} ${copy.form.wording}` }).click();
  await record
    .getByLabel(copy.form.wording)
    .fill("Hi {{1}}, your fitting is tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.");
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect(record.getByRole("alert")).toHaveText(copy.errors.first_line);
});

test("puts a line back to the code’s wording from its history, read in its box before it is kept", async ({
  page,
}) => {
  let sent: unknown = null;
  await open(page, {
    "GET /api/words/history": json({
      versions: [
        {
          id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
          text: HERO.now,
          set_by: "growth@maneman.test",
          set_at: "2026-10-05T06:30:00.000Z",
        },
      ],
    }),
    "POST /api/words": (route: Route) => {
      sent = route.request().postDataJSON();
      return json({ word: { ...HERO, now: HERO.text, changed: null } })(route);
    },
  });
  const record = await recordOf(page, "Top of the page · Title");
  await record.getByRole("button", { name: copy.form.toCode }).click();
  const box = record.getByRole("textbox", { name: copy.form.wording });
  await expect(box).toHaveValue(HERO.text);
  await expect(box).toBeFocused();
  expect(sent).toBeNull();
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect.poll(() => sent).toEqual({ key: HERO.key, text: null });
});

test("publishes the site’s changed words once confirmed", async ({ page }) => {
  let published = false;
  await open(page, {
    "POST /api/words/publish": (route: Route) => {
      published = true;
      return json({ published: { at: "2026-10-11T06:30:00.000Z", by: "growth@maneman.test", lines: 1 } })(route);
    },
  });
  await page.getByRole("button", { name: copy.publish.open }).click();
  await expect(page.getByText(copy.publish.changed(1))).toBeVisible();
  expect(published).toBe(false);
  await page.getByRole("button", { name: review.send, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(copy.publish.done);
  expect(published).toBe(true);
});
