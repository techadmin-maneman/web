// Growth · Words in the console (apps/ops/src/words/; docs/decisions/0126-the-words-page.md): the lines, a line's
// wording changed where it reads in its record, and a line put back to the code's wording from its history, read in its
// box before it is kept. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../../apps/ops/src/api.ts";
import { EDITING, review } from "../../apps/ops/src/content/common.ts";
import { words as copy } from "../../apps/ops/src/content/words.ts";
import { WordsScreen } from "../../apps/ops/src/words/WordsScreen.tsx";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";

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

let page: HTMLDivElement;
let root: Root;
let answers: Map<string, (init?: RequestInit) => Response>;
let sent: unknown[];

beforeEach(() => {
  // The drawers open beside the page, as modal dialogs (../../apps/ops/src/components/FormDrawer.tsx).
  openDialogsAsJsdomCan();
  answers = new Map([
    ["GET /api/words", () => Response.json({ words: [REMINDER, HERO], published: null, messages: "at_once" })],
    ["GET /api/words/history", () => Response.json({ versions: [] })],
  ]);
  sent = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://ops.maneman.test").pathname;
      if (typeof init?.body === "string") sent.push(JSON.parse(init.body));
      const reply = answers.get(`${init?.method ?? "GET"} ${path}`);
      const refused = () => Response.json({ error: { code: "unavailable", request_id: "request-1" } }, { status: 503 });
      return Promise.resolve((reply ?? refused)(init));
    }),
  );
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

const settle = () => answered();

async function show() {
  act(() => {
    root.render(createElement(WordsScreen));
  });
  await settle();
}

const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === label || each.textContent.trim() === label,
  );

async function press(label: string) {
  await act(async () => {
    button(label)?.click();
    await answered();
  });
}

function type(text: string) {
  const box = document.body.querySelector("textarea");
  if (box === null) throw new Error("no wording box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the Words page", () => {
  it("lists each line with the wording in force, and who changed it", async () => {
    await show();
    expect(document.body.textContent).toContain("Hair, fitted at home.");
    expect(document.body.textContent).toContain(copy.changed("growth@maneman.test", "Mon 5 Oct"));
    expect(document.body.textContent).toContain("Visit reminder");
    expect(document.body.textContent).not.toContain("visit_reminder_v1");
  });

  // Half the client's copy was written in code and never read in a copy review, with nothing to say which.
  it("marks a line whose wording in the code no copy review has read", async () => {
    await show();
    const rows = [...document.body.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows.find((row) => row.includes("Hair, fitted at home."))).toContain(copy.review.notReviewed);
    expect(rows.find((row) => row.includes("Visit reminder"))).not.toContain(copy.review.notReviewed);
    // Find words lists those lines alone.
    const find = document.body.querySelector<HTMLInputElement>(
      `input[aria-label="${copy.narrow}"], input[type="search"]`,
    );
    if (find === null) throw new Error("no Find words box");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(find, copy.review.notReviewed);
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const found = [...document.body.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(found.some((row) => row.includes("Hair, fitted at home."))).toBe(true);
    expect(found.some((row) => row.includes("Visit reminder"))).toBe(false);
  });

  it("saves a line's wording where it reads", async () => {
    const reworded = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}.";
    answers.set("POST /api/words", () =>
      Response.json({
        word: { ...REMINDER, now: reworded, changed: { by: "growth@maneman.test", at: "2026-10-11T06:30:00.000Z" } },
      }),
    );
    await show();
    await press(copy.open("Visit reminder"));
    expect(document.body.textContent).toContain(copy.form.code);
    expect(document.body.textContent).toContain(copy.form.atOnce);
    await press(`${EDITING.change} ${copy.form.wording}`);
    type(reworded);
    expect(sent).toEqual([]);
    await press(EDITING.save);
    expect(sent).toEqual([{ key: REMINDER.key, text: reworded }]);
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(EDITING.saved);
  });

  it("says why the words were refused", async () => {
    answers.set("POST /api/words", () =>
      Response.json({ error: { code: "invalid_request", fields: ["text.holes"], request_id: "r-1" } }, { status: 400 }),
    );
    await show();
    await press(copy.open("Visit reminder"));
    await press(`${EDITING.change} ${copy.form.wording}`);
    type("Hi {{1}}, see you tomorrow.");
    await press(EDITING.save);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.holes);
    // Said on the box it names, which is marked as refused and described by it.
    const box = document.body.querySelector("textarea");
    expect(box?.getAttribute("aria-invalid")).toBe("true");
    const described = (box?.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id));
    expect(described.map((each) => each?.textContent)).toContain(copy.errors.holes);
  });

  it("puts a line back to the code’s wording from its history", async () => {
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
    await press(copy.open("Top of the page · Title"));
    expect(document.body.textContent).toContain(copy.versions.by("growth@maneman.test", "Mon 5 Oct"));
    await press(copy.form.toCode);
    expect(document.body.querySelector("textarea")?.value).toBe(HERO.text);
    expect(sent).toEqual([]);
    await press(EDITING.save);
    expect(sent).toEqual([{ key: HERO.key, text: null }]);
  });

  it("publishes the site’s changed words once confirmed", async () => {
    answers.set("POST /api/words/publish", () =>
      Response.json({ published: { at: "2026-10-11T06:30:00.000Z", by: "growth@maneman.test", lines: 1 } }),
    );
    await show();
    expect(document.body.textContent).toContain(copy.publish.never);
    expect(document.body.textContent).toContain(copy.notOnSite);
    await press(copy.publish.open);
    expect(document.body.textContent).toContain(copy.publish.changed(1));
    await press(review.send);
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(copy.publish.done);
  });
});
