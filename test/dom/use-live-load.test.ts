// A page's data that keeps itself current (packages/ui/useLoad.ts, useLiveLoad): read again in view without the
// loading state, a failed read again keeping what is shown, and "Try again" starting from loading. And useLoad's: a
// page opened again shows its last answer while it reads, and reads again once a write lands.

import { dataChanged, forgetKept, useLiveLoad, useLoad } from "@maneman/ui/useLoad";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { ok: true; body: string } | { ok: false; status: number; requestId: string | null };

let page: HTMLDivElement;
let root: Root;
let answers: Answer[];
let reads: number;
let shown: { refresh: () => void; retry: () => void };

const NOT_THERE: Answer = { ok: false, status: 503, requestId: "r-1" };

const load = () => {
  reads += 1;
  return Promise.resolve(answers.shift() ?? NOT_THERE);
};

function Probe() {
  const { loaded, refresh, retry } = useLiveLoad(load, 20_000);
  shown = { refresh, retry };
  return createElement("p", null, loaded.state === "loaded" ? loaded.value : loaded.state);
}

const settle = () => act(() => Promise.resolve());

beforeEach(() => {
  forgetKept();
  vi.useFakeTimers();
  reads = 0;
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.useRealTimers();
});

describe("useLiveLoad", () => {
  it("reads again in place while in view, and keeps what is shown through a read that fails", async () => {
    answers = [
      { ok: true, body: "two chats" },
      { ok: true, body: "three chats" },
      { ok: false, status: 503, requestId: "r-2" },
    ];
    act(() => {
      root.render(createElement(Probe));
    });
    expect(page.textContent).toBe("loading");
    await settle();
    expect(page.textContent).toBe("two chats");

    act(() => {
      shown.refresh();
    });
    // Never the loading state between the two.
    expect(page.textContent).toBe("two chats");
    await settle();
    expect(page.textContent).toBe("three chats");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(reads).toBe(3);
    expect(page.textContent).toBe("three chats");
  });

  it("shows loading, then the failure, on Try again", async () => {
    answers = [
      { ok: false, status: 503, requestId: "r-1" },
      { ok: true, body: "one chat" },
    ];
    act(() => {
      root.render(createElement(Probe));
    });
    await settle();
    expect(page.textContent).toBe("failed");
    act(() => {
      shown.retry();
    });
    expect(page.textContent).toBe("loading");
    await settle();
    expect(page.textContent).toBe("one chat");
  });
});

describe("useLoad", () => {
  function Page() {
    const [loaded] = useLoad(load);
    return createElement("p", null, loaded.state === "loaded" ? loaded.value : loaded.state);
  }

  it("shows a page opened again its last answer while it reads, and reads again once a write lands", async () => {
    answers = [
      { ok: true, body: "one chat" },
      { ok: true, body: "two chats" },
      { ok: true, body: "three chats" },
    ];
    act(() => {
      root.render(createElement(Page));
    });
    await settle();
    expect(page.textContent).toBe("one chat");
    act(() => {
      root.render(createElement("p"));
    });
    act(() => {
      root.render(createElement(Page));
    });
    expect(page.textContent).toBe("one chat");
    await settle();
    expect(page.textContent).toBe("two chats");
    act(() => {
      dataChanged();
    });
    await act(() => vi.advanceTimersByTimeAsync(300));
    await settle();
    expect(page.textContent).toBe("three chats");
    expect(reads).toBe(3);
  });
});
