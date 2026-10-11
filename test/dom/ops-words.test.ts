// Growth · Words in the console (apps/ops/src/words/; docs/decisions/0126-the-words-page.md): the lines, a line
// changed once reviewed, and a line put back to the code's wording from its history. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../../apps/ops/src/api.ts";
import { words as copy } from "../../apps/ops/src/content/words.ts";
import { WordsScreen } from "../../apps/ops/src/words/WordsScreen.tsx";

const REMINDER: Word = {
  key: "message:visit_reminder_v1",
  surface: "message",
  group: "Messages",
  where: "visit_reminder_v1",
  text: "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.",
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
  now: "Hair, fitted at home.",
  changed: { by: "growth@maneman.test", at: "2026-10-05T06:30:00.000Z" },
  longest: 50,
  on_site: false,
};

let page: HTMLDivElement;
let root: Root;
let answers: Map<string, (init?: RequestInit) => Response>;
let sent: unknown[];

beforeEach(() => {
  answers = new Map([
    ["GET /api/words", () => Response.json({ words: [REMINDER, HERO], published: null, messages: "at_once" })],
  ]);
  sent = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const path = new URL(url, "https://ops.maneman.test").pathname;
    if (typeof init?.body === "string") sent.push(JSON.parse(init.body));
    const reply = answers.get(`${init?.method ?? "GET"} ${path}`);
    const refused = () => Response.json({ error: { code: "unavailable", request_id: "request-1" } }, { status: 503 });
    return Promise.resolve((reply ?? refused)(init));
  });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function show() {
  act(() => {
    root.render(createElement(WordsScreen));
  });
  await settle();
}

const button = (label: string) =>
  [...page.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === label || each.textContent.trim() === label,
  );

async function press(label: string) {
  await act(async () => {
    button(label)?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function type(text: string) {
  const box = page.querySelector("textarea");
  if (box === null) throw new Error("no wording box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the Words page", () => {
  it("lists each line with the wording in force, and who changed it", async () => {
    await show();
    expect(page.textContent).toContain("Hair, fitted at home.");
    expect(page.textContent).toContain(copy.changed("growth@maneman.test", "Mon 5 Oct"));
    expect(page.textContent).toContain("visit_reminder_v1");
  });

  it("saves a line once its change is reviewed", async () => {
    const reworded = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}.";
    answers.set("POST /api/words", () =>
      Response.json({
        word: { ...REMINDER, now: reworded, changed: { by: "growth@maneman.test", at: "2026-10-11T06:30:00.000Z" } },
      }),
    );
    await show();
    await press(copy.editLabel("visit_reminder_v1"));
    expect(page.textContent).toContain(copy.form.inCode(REMINDER.text));
    expect(page.textContent).toContain(copy.form.atOnce);
    type(reworded);
    await press(copy.form.next);
    expect(page.textContent).toContain(copy.check.now(reworded));
    expect(sent).toEqual([]);
    await press(copy.check.send);
    expect(sent).toEqual([{ key: REMINDER.key, text: reworded }]);
    expect(page.querySelector('[role="status"]')?.textContent).toBe(copy.done);
  });

  it("says why the words were refused", async () => {
    answers.set("POST /api/words", () =>
      Response.json({ error: { code: "invalid_request", fields: ["text.holes"], request_id: "r-1" } }, { status: 400 }),
    );
    await show();
    await press(copy.editLabel("visit_reminder_v1"));
    type("Hi {{1}}, see you tomorrow.");
    await press(copy.form.next);
    await press(copy.check.send);
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.holes);
  });

  it("puts a line back to the code's wording from its history", async () => {
    answers.set("GET /api/words/history", () =>
      Response.json({
        versions: [
          {
            id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
            text: HERO.now,
            set_by: "growth@maneman.test",
            set_at: "2026-10-05T06:30:00.000Z",
          },
        ],
      }),
    );
    answers.set("POST /api/words", () =>
      Response.json({ word: { ...HERO, now: HERO.text, changed: null, on_site: false } }),
    );
    await show();
    await press(copy.historyLabel("hero.title"));
    expect(page.textContent).toContain(copy.versions.by("growth@maneman.test", "Mon 5 Oct"));
    await press(copy.form.toCode);
    expect(page.querySelector("textarea")?.value).toBe(HERO.text);
    await press(copy.form.next);
    await press(copy.check.send);
    expect(sent).toEqual([{ key: HERO.key, text: null }]);
  });

  it("publishes the site's changed words once confirmed", async () => {
    answers.set("POST /api/words/publish", () =>
      Response.json({ published: { at: "2026-10-11T06:30:00.000Z", by: "growth@maneman.test", lines: 1 } }),
    );
    await show();
    expect(page.textContent).toContain(copy.publish.never);
    expect(page.textContent).toContain(copy.notOnSite);
    await press(copy.publish.open);
    expect(page.textContent).toContain(copy.publish.changed(1));
    await press(copy.publish.send);
    expect(page.querySelector('[role="status"]')?.textContent).toBe(copy.publish.done);
  });
});
