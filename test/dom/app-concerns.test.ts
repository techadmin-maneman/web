// The client app's Your data card: the concerns the client raised, with our answers, and the day's limit on
// new ones.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../../apps/app/src/api.ts";
import { DataCard } from "../../apps/app/src/profile/DataCard.tsx";

const ANSWERED: Profile["grievances"][number] = {
  id: "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f",
  text: "Who sees my photographs?",
  state: "resolved",
  raised_at: "2026-10-02T06:30:00.000Z",
  response: "Only your technician and our care team.",
  answered_at: "2026-10-03T06:30:00.000Z",
};

const OPEN: Profile["grievances"][number] = {
  id: "0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b",
  text: "Please stop the launch messages.",
  state: "open",
  raised_at: "2026-10-04T06:30:00.000Z",
  response: null,
  answered_at: null,
};

let page: HTMLElement;
let root: Root;
let raised: number;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  raised = 0;
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

function draw(grievances: Profile["grievances"]) {
  act(() => {
    root.render(
      createElement(DataCard, {
        grievances,
        onRaised: () => {
          raised += 1;
        },
      }),
    );
  });
}

const button = (name: string) => {
  const found = [...page.querySelectorAll("button")].find((each) => each.textContent === name);
  if (found === undefined) throw new Error(`No "${name}" button on the page.`);
  return found;
};

/** Writes a concern and sends it, then waits for the answer to be drawn. */
async function sendConcern(text: string) {
  act(() => {
    button("Raise a concern").click();
  });
  const field = page.querySelector("textarea");
  if (field === null) throw new Error("No concern field on the page.");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    button("Send").click();
  });
  for (let turn = 0; turn < 20 && page.querySelector('[role="alert"], [role="status"]') === null; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("the concerns a client raised", () => {
  it("lists each with its day, where it stands, their words and our answer", () => {
    draw([OPEN, ANSWERED]);
    const items = [...page.querySelectorAll('ul[aria-label="Your concerns"] li')].map((item) =>
      [...item.children].map((line) => line.textContent),
    );
    expect(items).toEqual([
      ["Your concern of 4 Oct 2026 · Awaiting our reply", "Please stop the launch messages."],
      [
        "Your concern of 2 Oct 2026 · Answered 3 Oct 2026",
        "Who sees my photographs?",
        "Our answer: Only your technician and our care team.",
      ],
    ]);
  });

  it("draws no list before the first concern", () => {
    draw([]);
    expect(page.querySelector('ul[aria-label="Your concerns"]')).toBeNull();
  });

  it("says a sent concern is received, and asks for the list again", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ id: OPEN.id, state: "open" }, { status: 201 })));
    draw([]);
    await sendConcern("Please stop the launch messages.");
    expect(page.querySelector('[role="status"]')?.textContent).toBe(
      "Received. We reply here and on WhatsApp, usually within a working day and within 30 days at the latest.",
    );
    expect(raised).toBe(1);
  });

  it("says when the day's concerns are spent, and keeps the words", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ error: { code: "rate_limited", request_id: "r-1" } }, { status: 429 })),
    );
    draw([]);
    await sendConcern("One more thing.");
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "You have reached today's limit. Send it tomorrow, or message us on WhatsApp.",
    );
    expect(page.querySelector("textarea")?.value).toBe("One more thing.");
    expect(raised).toBe(0);
  });
});
