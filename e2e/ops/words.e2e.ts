// Growth · Words (docs/decisions/0126-the-words-page.md), which no board draws. Every name is made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { words as copy } from "../../apps/ops/src/content/words.ts";

type Word = OpsReply<"/api/words">["words"][number];

const REMINDER: Word = {
  key: "message:visit_reminder_v1",
  surface: "message",
  group: "Messages",
  where: "visit_reminder_v1",
  text: "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.",
  now: "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.",
  changed: null,
  longest: 94,
};
const HERO: Word = {
  key: "site:home/hero.title",
  surface: "site",
  group: "Home",
  where: "hero",
  text: "A hair system, fitted at home.",
  now: "Hair, fitted at home.",
  changed: { by: "growth@maneman.test", at: "2026-10-05T06:30:00.000Z" },
  longest: 50,
};
const FAQ: Word = {
  ...HERO,
  key: "site:home/faq.title",
  where: "faq",
  text: "Questions",
  now: "Questions",
  changed: null,
  longest: 29,
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await answer(page, { "GET /api/words": json({ words: [REMINDER, HERO, FAQ] }), ...extra });
  await page.goto("/words");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const row = (page: Page, place: string) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: place, exact: true }) });

test("lists every line with the wording in force, and who changed it", async ({ page }) => {
  await open(page);
  await expect(row(page, "hero.title").getByRole("cell").nth(1)).toHaveText(
    "Hair, fitted at home.Changed by growth@maneman.test, Mon 5 Oct",
  );
  await expect(row(page, "visit_reminder_v1")).toBeVisible();
});

test("changes a message once the change is reviewed, keeping its details", async ({ page }) => {
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
  await row(page, "visit_reminder_v1")
    .getByRole("button", { name: copy.editLabel("visit_reminder_v1") })
    .click();
  await expect(page.getByText(copy.form.keep("{{1}}, {{2}}, {{3}}, {{4}}, {{5}}"), { exact: false })).toBeVisible();
  const reworded = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}.";
  await page.getByLabel(copy.form.wording).fill(reworded);
  await page.getByRole("button", { name: copy.form.next }).click();
  await expect(page.getByText(/^Now: Hi \{\{1\}\}, see you tomorrow\./)).toBeVisible();
  expect(sent).toBeNull();
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done);
  expect(sent).toEqual({ key: REMINDER.key, text: reworded });
});

test("says why words are refused", async ({ page }) => {
  await open(page, {
    "POST /api/words": json(
      { error: { code: "invalid_request", fields: ["text.first_line"], request_id: "r-1" } },
      400,
    ),
  });
  await row(page, "visit_reminder_v1")
    .getByRole("button", { name: copy.editLabel("visit_reminder_v1") })
    .click();
  await page
    .getByLabel(copy.form.wording)
    .fill("Hi {{1}}, your fitting is tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.");
  await page.getByRole("button", { name: copy.form.next }).click();
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.errors.first_line);
});

test("puts a line back to the code's wording from its history", async ({ page }) => {
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
  await row(page, "hero.title")
    .getByRole("button", { name: copy.historyLabel("hero.title") })
    .click();
  await page.getByRole("button", { name: copy.form.toCode }).click();
  await expect(page.getByLabel(copy.form.wording)).toHaveValue(HERO.text);
  await page.getByRole("button", { name: copy.form.next }).click();
  await page.getByRole("button", { name: copy.check.send }).click();
  expect(sent).toEqual({ key: HERO.key, text: null });
});
