// A move the client has not heard of, settled from its row on the Tasks board (apps/ops/src/tasks/CallAboutMove.tsx):
// the number to call, and "Told by phone", which closes the task. Ops had to open the dispatch board
// and hunt for the block to record the call.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskGroup } from "../../apps/ops/src/api.ts";
import { CallAboutMove } from "../../apps/ops/src/tasks/CallAboutMove.tsx";

const MOVE = "55555555-5555-4555-8555-555555555555";

const UNTOLD: Task = {
  id: MOVE,
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Rohit Malhotra", mobile: "+919810000001" },
  visit: { id: "22222222-2222-4222-8222-222222222222", starts_at: "2027-09-23T03:30:00.000Z" },
  detail: "2027-09-23T03:30:00.000Z",
  since: "2027-09-21T06:00:00.000Z",
  due: "2027-09-21T10:00:00.000Z",
  owner: null,
};

let page: HTMLElement;
let root: Root;
let told: string[];
let toldAnswer: () => Response;
let closed: number;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  told = [];
  closed = 0;
  toldAnswer = () => Response.json({ told: true });
  vi.stubGlobal("fetch", (url: string, init: { method?: string } | undefined) => {
    const path = new URL(url, "https://ops.maneman.test").pathname;
    if (init?.method === "POST") {
      told.push(path);
      return Promise.resolve(toldAnswer());
    }
    // Who is signed in: unknown, so every action is shown and the API refuses what it must.
    return Promise.resolve(
      Response.json({ error: { code: "unknown", message: "", request_id: "r" } }, { status: 500 }),
    );
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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function show(task: Task, group: TaskGroup["group"] = "untold_move") {
  act(() => {
    root.render(
      createElement(CallAboutMove, {
        group,
        task,
        subject: "Rohit Malhotra",
        onTold: () => {
          closed += 1;
        },
      }),
    );
  });
  await settle();
}

const toldButton = () => {
  const found = [...page.querySelectorAll("button")].find((each) => each.textContent.startsWith("Told by phone"));
  if (found === undefined) throw new Error(`No "Told by phone" in: ${page.textContent}`);
  return found;
};

async function pressTold() {
  act(() => {
    toldButton().click();
  });
  await settle();
}

describe("a move the client has not heard of, on its task", () => {
  it("gives the number to call, as a link a phone dials", async () => {
    await show(UNTOLD);
    const call = page.querySelector("a");
    expect(call?.getAttribute("href")).toBe("tel:+919810000001");
    expect(call?.textContent).toBe("Call +91 98100 00001 · Rohit Malhotra");
  });

  it("records the call and closes the task", async () => {
    await show(UNTOLD);
    await pressTold();
    expect(told).toEqual([`/api/dispatch/moves/${MOVE}/told`]);
    expect(closed).toBe(1);
  });

  it("closes the task when the call was recorded meanwhile, or a later move told the client", async () => {
    toldAnswer = () =>
      Response.json({ error: { code: "not_found", message: "", request_id: "r", fields: [] } }, { status: 404 });
    await show(UNTOLD);
    await pressTold();
    expect(closed).toBe(1);
  });

  it("keeps the task, and says so, when the record did not go through", async () => {
    toldAnswer = () =>
      Response.json({ error: { code: "unknown", message: "", request_id: "r", fields: [] } }, { status: 500 });
    await show(UNTOLD);
    await pressTold();
    expect(closed).toBe(0);
    expect(page.querySelector("[role=alert]")?.textContent).toBe("That was not recorded. Try again.");
  });

  it("shows nothing on a task with no number to call, or of another group", async () => {
    const { person } = UNTOLD;
    if (person === null) throw new Error("the fixture names its client");
    await show({ ...UNTOLD, person: { id: person.id, name: person.name } });
    expect(page.textContent).toBe("");
    await show(UNTOLD, "leave_conflict");
    expect(page.textContent).toBe("");
  });
});
