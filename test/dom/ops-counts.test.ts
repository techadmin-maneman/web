// Operations · Counts in the console (apps/ops/src/counts/; docs/decisions/0185-cycle-counts.md): a task counted blind
// and counted again, one signed off with why beside what the ledger held, and an item's class changed. Every name is
// made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountsScreen } from "../../apps/ops/src/counts/CountsScreen.tsx";
import { counts as copy } from "../../apps/ops/src/content/counts.ts";

const KIT = {
  id: "ct-1",
  place_id: "kit-1",
  place: "Imran Qureshi",
  item: null,
  count_class: "weekly",
  due_on: "2026-09-21",
  state: "open",
};
const ROOM = { ...KIT, id: "ct-2", place_id: "room-1", place: "Delhi stockroom", state: "sign_off" };
const BOOK = {
  tasks: [KIT, ROOM],
  places: [{ id: "room-1", name: "Delhi stockroom" }],
  classes: [
    { consumable_code: "solvent", name: "Solvent", count_class: "quarterly", set: false, hair_system: false },
    { consumable_code: "hs-1", name: "Essential 8×10", count_class: "weekly", set: false, hair_system: true },
  ],
};
const PIECE = { consumable_code: "hs-1", name: "Essential 8×10", labelled: false, unknown_labels: [] };

let page: HTMLDivElement;
let root: Root;
let posted: { path: string; body: unknown }[];
let answers: unknown[];

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement | null | undefined)?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

function type(input: HTMLInputElement | HTMLSelectElement | null | undefined, value: string) {
  act(() => {
    if (input === null || input === undefined) return;
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const labelled = (label: string) => {
  const id = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label)?.htmlFor ?? "";
  return page.querySelector<HTMLInputElement>(`[id="${id}"]`);
};

beforeEach(() => {
  posted = [];
  answers = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const address = new URL(url, "https://ops.maneman.test");
    if (init?.method === "POST") {
      posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      return Promise.resolve(Response.json(answers.shift() ?? BOOK));
    }
    const answer: Record<string, unknown> = {
      "/api/count-tasks": BOOK,
      "/api/count-tasks/ct-1": { task: KIT, items: [{ ...PIECE, state: "to_count" }] },
      "/api/count-tasks/ct-2": { task: ROOM, items: [{ ...PIECE, state: "sign_off" }] },
      "/api/count-tasks/ct-2/differences": {
        lines: [{ ...PIECE, held: 2, counted: 1, recounted: 1, missing_labels: [], unknown_labels: [] }],
      },
    };
    const body = answer[address.pathname];
    if (body !== undefined) return Promise.resolve(Response.json(body));
    return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
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

async function show() {
  act(() => {
    root.render(createElement(CountsScreen));
  });
  await settle();
}

const opener = (place: string) =>
  page.querySelector(`button[aria-label="${copy.open} ${copy.heading(place, copy.classes.weekly)}"]`);

describe("the Counts page", () => {
  it("counts a task blind, then counts again what differed", async () => {
    await show();
    expect(page.textContent).toContain(copy.states.sign_off);
    await press(opener("Imran Qureshi"));
    expect(page.textContent).toContain(copy.countNote);
    expect(page.textContent).not.toContain("held");
    answers = [
      { task: { ...KIT, state: "recount" }, items: [{ ...PIECE, state: "recount" }] },
      { task: { ...KIT, state: "done" }, items: [{ ...PIECE, state: "settled" }] },
    ];
    type(labelled(copy.counted(PIECE.name)), "1");
    await press(button(copy.saveCount));
    expect(posted[0]).toEqual({
      path: "/api/count-tasks/ct-1/counts",
      body: { lines: [{ consumable_code: "hs-1", counted: 1 }] },
    });
    expect(page.textContent).toContain(copy.countSaid(1));
    type(labelled(copy.counted(PIECE.name)), "1");
    await press(button(copy.saveRecount));
    expect(posted[1]?.path).toBe("/api/count-tasks/ct-1/recounts");
    expect(page.textContent).toContain(copy.done);
  });

  it("signs off a difference with why, beside what the ledger held, and changes an item’s class", async () => {
    await show();
    await press(opener("Delhi stockroom"));
    expect(page.textContent).toContain(copy.differencesColumns[1]);
    answers = [{ task: { ...ROOM, state: "done" }, items: [{ ...PIECE, state: "settled" }] }];
    type(labelled(copy.why), "One piece not found");
    await press(button(copy.signOff));
    expect(posted[0]).toEqual({ path: "/api/count-tasks/ct-2/sign-off", body: { note: "One piece not found" } });
    expect(page.textContent).toContain(copy.signedSaid);

    answers = [{ ...BOOK, classes: [{ ...BOOK.classes[0], count_class: "monthly", set: true }, BOOK.classes[1]] }];
    type(
      page.querySelector<HTMLSelectElement>(`select[id="${labelled(copy.classLabel("Solvent"))?.id ?? ""}"]`),
      "monthly",
    );
    await settle();
    expect(posted[1]).toEqual({ path: "/api/consumables/solvent/count-class", body: { count_class: "monthly" } });
    expect(page.textContent).toContain(copy.classSaid);
  });
});
