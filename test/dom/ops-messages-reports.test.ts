// Customer Care · Messages and the issue log (apps/ops/src/care/; docs/decisions/0258-the-issue-log.md): the photographs
// a client sent with their reports beside their chat, fetched only once Care ask, and the chat a task's link names
// opened and brought into view. Every name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessagesScreen } from "../../apps/ops/src/care/MessagesScreen.tsx";
import { care as copy } from "../../apps/ops/src/content/care.ts";
import { contractChecked } from "./contract-fetch.ts";
import { ARJUN, IMRAN } from "./ops-messages-fixtures.ts";
import { answered } from "./render-hook.ts";

const REPORT = "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f";
const PHOTOS = [1, 2].map((n) => ({ report_id: REPORT, reference: "MM-ISS-0001", n, at: "2026-09-21T05:00:00.000Z" }));

let page: HTMLDivElement;
let root: Root;
let asked: string[];
/** How long the list of chats takes to answer, for a link's chat that answers first. */
let listLate = 0;
let scrolled: Element[];

/** What the screen asks of the API: the chats, Arjun's and Imran's chat, and Arjun's report photographs. */
function answer(url: string): Promise<Response> {
  const path = new URL(url, "https://ops.maneman.test").pathname;
  asked.push(path);
  if (path === "/api/conversations") {
    const list = Response.json({ conversations: [ARJUN], next_cursor: null });
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(list);
      }, listLate),
    );
  }
  if (path === `/api/conversations/${ARJUN.id}`) {
    return Promise.resolve(Response.json({ conversation: ARJUN, items: [], close_reason: null }));
  }
  if (path === `/api/conversations/${IMRAN.id}`) {
    return Promise.resolve(Response.json({ conversation: IMRAN, items: [], close_reason: null }));
  }
  if (path === `/api/conversations/${ARJUN.id}/report-photos`)
    return Promise.resolve(Response.json({ photos: PHOTOS }));
  if (path.startsWith(`/api/conversations/${ARJUN.id}/report-photos/`)) {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    return Promise.resolve(new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } }));
  }
  return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
}

beforeEach(() => {
  asked = [];
  listLate = 0;
  scrolled = [];
  Reflect.set(Element.prototype, "scrollIntoView", function (this: Element) {
    scrolled.push(this);
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }));
  vi.stubGlobal("fetch", contractChecked("ops", answer));
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
    root.render(createElement(MessagesScreen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, listLate * 2));
    await answered();
  });
}

describe("the Messages page and the issue log", () => {
  it("shows the photographs the client sent with their reports beside the chat, only once asked for", async () => {
    await show();
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>(`ul[aria-label="${copy.chats}"] button`)]
        .find((each) => each.textContent.includes("Arjun Mehta"))
        ?.click();
      await answered();
    });
    const panel = document.body.querySelector(`[aria-label="${copy.panel.title}"]`);
    // A viewing is logged, so nothing is fetched until Care ask.
    expect(asked.filter((path) => path.includes("/report-photos/"))).toEqual([]);
    const button = [...(panel?.querySelectorAll("button") ?? [])].find((each) =>
      each.textContent.includes(copy.reportPhotos.show(2)),
    );
    await act(async () => {
      button?.click();
      await answered();
    });
    expect([...(panel?.querySelectorAll("img") ?? [])].map((image) => image.getAttribute("alt"))).toEqual([
      copy.reportPhotos.alt("MM-ISS-0001", 1),
      copy.reportPhotos.alt("MM-ISS-0001", 2),
    ]);
    expect(panel?.textContent).toContain(copy.reportPhotos.caption("MM-ISS-0001", 2));
    expect(asked).toContain(`/api/conversations/${ARJUN.id}/report-photos/${REPORT}/1`);
  });

  it("opens the chat a task's link names, whichever view, in view once the list answers, if it answers last", async () => {
    listLate = 30;
    window.history.replaceState(null, "", `/messages#chat-${IMRAN.id}`);
    await show();
    const chat = document.body.querySelector(`[aria-label="${copy.thread.title("Imran Qureshi")}"]`);
    expect(window.location.hash).toBe("");
    expect(scrolled).toContain(chat?.parentElement);
  });
});
