// Customer Care · Messages in the console (apps/ops/src/care/; docs/decisions/0129-the-care-inbox.md): the chats a view
// at a time, and a chat opened with our automatic messages in it. Every name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../apps/ops/src/care/care-api.ts";
import { MessagesScreen } from "../../apps/ops/src/care/MessagesScreen.tsx";
import { care as copy } from "../../apps/ops/src/content/care.ts";

const ARJUN: Conversation = {
  id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  mobile: "+919810000001",
  state: "open",
  last_message_at: "2026-09-21T05:12:00.000Z",
  last_line: "Can I move tomorrow's visit to the evening?",
  waiting_since: "2026-09-21T05:12:00.000Z",
};
const STRANGER: Conversation = {
  ...ARJUN,
  id: "9d2e0a5c-6f7b-4c8d-0e9f-4a5b6c7d8e9f",
  person: null,
  mobile: "+919811112222",
  last_line: "Do you come to Noida?",
};

let page: HTMLDivElement;
let root: Root;
let asked: string[];
let posted: { path: string; body: unknown }[];

beforeEach(() => {
  asked = [];
  posted = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const address = new URL(url, "https://ops.maneman.test");
    asked.push(`${address.pathname}${address.search}`);
    if (init?.method === "POST" && typeof init.body === "string") {
      posted.push({ path: address.pathname, body: JSON.parse(init.body) as unknown });
      const replied = {
        kind: "out",
        at: "2026-09-21T05:20:00.000Z",
        author: "care@maneman.test",
        text: "Yes, 6 pm works.",
        delivery: "sent",
      };
      return Promise.resolve(Response.json({ conversation: { ...ARJUN, state: "waiting" }, items: [replied] }));
    }
    if (address.pathname === "/api/conversations") {
      const view = address.searchParams.get("view");
      return Promise.resolve(Response.json({ conversations: view === "closed" ? [] : [ARJUN, STRANGER] }));
    }
    if (address.pathname === `/api/conversations/${ARJUN.id}`) {
      return Promise.resolve(
        Response.json({
          conversation: ARJUN,
          items: [
            {
              kind: "auto",
              at: "2026-09-20T04:00:01.000Z",
              message: "visit_reminder",
              state: "sent",
              delivered_at: "2026-09-20T04:00:05.000Z",
              read_at: null,
            },
            { kind: "in", at: ARJUN.last_message_at, author: "client", text: ARJUN.last_line },
          ],
        }),
      );
    }
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

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function show() {
  act(() => {
    root.render(createElement(MessagesScreen));
  });
  await settle();
}

describe("the Messages page", () => {
  it("lists the chats waiting on us, a number we don't know by that", async () => {
    await show();
    expect(asked).toContain("/api/conversations?view=open");
    expect(page.textContent).toContain("Arjun Mehta");
    expect(page.textContent).toContain(ARJUN.last_line);
    expect(page.textContent).toContain(copy.unknown);
  });

  it("opens a chat with our automatic messages in it, and how far each got", async () => {
    await show();
    await act(async () => {
      page.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page.textContent).toContain(copy.thread.title("Arjun Mehta"));
    expect(page.textContent).toContain(copy.thread.auto("Visit reminder", [copy.thread.delivered]));
    expect(page.textContent).toContain(copy.thread.client);
  });

  it("shows another view when one is chosen", async () => {
    await show();
    const select = page.querySelector("select");
    await act(async () => {
      if (select !== null) {
        select.value = "closed";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(asked).toContain("/api/conversations?view=closed");
    expect(page.textContent).toContain(copy.none);
  });

  it("replies from our number, adds a note, and closes the chat with what it was about", async () => {
    await show();
    await act(async () => {
      page.querySelector<HTMLButtonElement>(`button[aria-label="${copy.openLabel("Arjun Mehta")}"]`)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const box = page.querySelector("textarea");
    act(() => {
      if (box !== null) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "Yes, 6 pm works.");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const press = async (label: string) => {
      await act(async () => {
        [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === label)?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await press(copy.compose.send);
    expect(posted).toEqual([{ path: `/api/conversations/${ARJUN.id}/replies`, body: { text: "Yes, 6 pm works." } }]);
    expect(page.querySelector('[role="status"]')?.textContent).toBe(copy.compose.sent);
    await press(copy.compose.closeChat);
    expect(posted.at(-1)).toEqual({ path: `/api/conversations/${ARJUN.id}/close`, body: { reason: "other" } });
    expect(page.querySelector('[role="status"]')?.textContent).toBe(copy.compose.closed);
  });
});
