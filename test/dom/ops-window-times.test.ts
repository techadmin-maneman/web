// Settings › Window times (apps/ops/src/settings/WindowTimes.tsx; docs/decisions/0102-window-times.md): the windows in
// force, a change of the day's times from a day the API allows, checked against the windows it moves, and a day too
// soon refused. Every time and name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotTimes } from "../../apps/ops/src/api.ts";
import { review } from "../../apps/ops/src/content/common.ts";
import { settings } from "../../apps/ops/src/content/settings.ts";
import { WindowTimes } from "../../apps/ops/src/settings/WindowTimes.tsx";
import { contractChecked } from "./contract-fetch.ts";
import { answered } from "./render-hook.ts";

const copy = settings.windowTimes;

const STARTS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30"];

const TIMES: SlotTimes = {
  in_force: {
    applies_from: null,
    unit_starts: STARTS,
    day_end: "21:00",
    windows: {
      morning: { start: "09:00", end: "12:00" },
      afternoon: { start: "12:00", end: "18:00" },
      evening: { start: "18:00", end: "21:00" },
    },
  },
  changes: [],
  earliest: "2026-12-01",
};

let page: HTMLDivElement;
let root: Root;
let sent: unknown[];
let answer: () => Response;
let served: SlotTimes;

beforeEach(() => {
  sent = [];
  served = TIMES;
  answer = () => Response.json({ applies_from: "2026-12-01" }, { status: 201 });
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      // Who is signed in is read once a change lands; nobody, here.
      if (url.endsWith("/api/whoami")) {
        return Response.json({ error: { code: "internal_error", request_id: "r-1" } }, { status: 500 });
      }
      if ((init?.method ?? "GET") === "GET") return Response.json(served);
      sent.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return answer();
    }),
  );
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
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
    root.render(createElement(WindowTimes));
  });
  await answered();
}

async function press(text: string) {
  await act(async () => {
    [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text)?.click();
    await answered();
  });
}

function type(label: string, value: string) {
  const field = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label);
  const box = page.querySelector<HTMLInputElement>(`#${CSS.escape(field?.htmlFor ?? "")}`);
  if (box === null) throw new Error(`no box ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The page's words, its hours' unbroken spaces read as spaces. */
const said = () => page.textContent.replaceAll("\u00a0", " ");

describe("the window times", () => {
  it("say each window's hours as the times in force read them", async () => {
    await show();
    expect(said()).toContain(`${copy.window.morning}: 9 am–12 noon`);
    expect(said()).toContain(`${copy.window.evening}: 6–9 pm`);
    expect(said()).toContain(copy.none);
  });

  // The list of changes said only the day and who set it, not what it set.
  it("say what each change sets, beside who set it", async () => {
    const later = ["09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00"];
    served = {
      ...TIMES,
      changes: [
        {
          applies_from: "2026-11-30",
          unit_starts: later,
          day_end: "21:00",
          set_by: "ops@maneman.in",
          set_at: "2026-10-01T05:00:00.000Z",
        },
      ],
    };
    await show();
    expect(said()).toContain(`${copy.window.morning} 9:30 am–12:30 pm`);
  });

  // A change set for the wrong day could not be taken back.
  it("withdraw the last change still to come, and say so", async () => {
    served = {
      ...TIMES,
      changes: [
        {
          applies_from: "2026-11-30",
          unit_starts: STARTS,
          day_end: "21:00",
          set_by: "ops@maneman.in",
          set_at: "2026-10-01T05:00:00.000Z",
        },
      ],
    };
    answer = () => new Response(null, { status: 204 });
    await show();
    await press(copy.withdrawing.open);
    await press(copy.withdrawing.confirm);
    expect(said()).toContain(copy.withdrawn);
  });

  it("change from the earliest day, checked against the windows they move", async () => {
    await show();
    type(copy.start(copy.window.evening, 1), "18:30");
    await press(review.next);
    expect(said()).toContain(`${copy.window.afternoon}: 12–6 pm → 12–6:30 pm`);
    expect(said()).toContain(`${copy.window.evening}: 6–9 pm → 6:30–9 pm`);
    expect(said()).toContain(`${copy.window.morning}: 9 am–12 noon`);
    await press(review.send);
    expect(sent).toEqual([
      {
        applies_from: "2026-12-01",
        unit_starts: ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:30", "19:30"],
        day_end: "21:00",
      },
    ]);
    expect(page.textContent).toContain(copy.set);
  });

  it("say a day too soon, by the box it names", async () => {
    answer = () =>
      Response.json(
        { error: { code: "slot_times_too_soon", request_id: "r-1", fields: ["applies_from"] } },
        { status: 409 },
      );
    await show();
    await press(review.next);
    await press(review.send);
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(copy.errors.slot_times_too_soon);
  });
});
