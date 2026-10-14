// A page's side of a new build (packages/web-kit/sw-update.ts), and the worker's (packages/web-kit/sw-shell.ts): a new
// build waits until a page tells it to take over; the page asks for one on each return to the front and hourly, says
// when one waits, takes it by a tap or while out of sight at rest, and loads again once it has taken over.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

class FakeWorker extends EventTarget {
  state = "installing";
  readonly posted: unknown[] = [];
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
  arrive(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
  }
}

let registration: FakeRegistration;
let container: EventTarget & { controller: object | null; register: () => Promise<FakeRegistration> };
let page: EventTarget & { visibilityState: string; open: boolean; querySelector: (selector: string) => object | null };
let reload: ReturnType<typeof vi.fn>;

/** The page opened under a worker of an earlier build, or with none, as on its very first visit. */
async function opened(under: "worker" | "none", { waiting = false } = {}) {
  registration = new FakeRegistration();
  if (waiting) registration.waiting = Object.assign(new FakeWorker(), { state: "installed" });
  container = Object.assign(new EventTarget(), {
    controller: under === "worker" ? {} : null,
    register: () => Promise.resolve(registration),
  });
  page = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    open: false,
    querySelector: (selector: string) => (selector === "dialog[open]" && page.open ? {} : null),
  });
  reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: container });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { location: { reload } });
  vi.resetModules();
  const kit = await import("../../../packages/web-kit/sw-update.ts");
  await kit.keepUpToDate();
  return kit;
}

const turn = (visibility: "visible" | "hidden") => {
  page.visibilityState = visibility;
  page.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a page open on an app", () => {
  it("asks for a new build each time it comes back to the front, and every hour", async () => {
    await opened("worker");
    turn("visible");
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("says a new build is ready once it waits, and has it take over at a tap", async () => {
    const kit = await opened("worker");
    const told = vi.fn();
    kit.onUpdateReady(told);
    const incoming = new FakeWorker();
    registration.arrive(incoming);
    expect(kit.updateReady()).toBe(false);
    incoming.become("installed");
    expect(told).toHaveBeenCalledTimes(1);
    expect(kit.updateReady()).toBe(true);

    kit.applyUpdate();
    expect(incoming.posted).toEqual([kit.TAKE_OVER]);
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("finds a build already waiting when it opens", async () => {
    const kit = await opened("worker", { waiting: true });
    expect(kit.updateReady()).toBe(true);
  });

  it("takes the build by itself only while out of sight at rest, with nothing open over the screen", async () => {
    const kit = await opened("worker");
    const incoming = new FakeWorker();
    registration.arrive(incoming);
    incoming.become("installed");

    turn("hidden");
    expect(incoming.posted).toEqual([]);

    kit.atRest(true);
    page.open = true;
    turn("hidden");
    expect(incoming.posted).toEqual([]);

    page.open = false;
    turn("hidden");
    expect(incoming.posted).toEqual([kit.TAKE_OVER]);
  });

  it("says nothing of the first worker, and is not reloaded when it takes over", async () => {
    const kit = await opened("none");
    const first = new FakeWorker();
    registration.arrive(first);
    first.become("installed");
    expect(kit.updateReady()).toBe(false);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });
});

// The worker's code is typed as a worker's (apps/*/sw/tsconfig.json), so it is read here as written.
describe("a new build’s worker", () => {
  const shell = readFileSync("packages/web-kit/sw-shell.ts", "utf8");
  const install = /addEventListener\("install"[\s\S]*?\n {2}\}\);/.exec(shell)?.[0] ?? "";

  it("keeps its shell and waits, rather than taking over at once", () => {
    expect(install).toContain("cache.addAll(shell.files)");
    expect(install).not.toContain("skipWaiting");
  });

  it("takes over when a page tells it to, in the words the page uses", async () => {
    const kit = await opened("worker");
    expect(shell).toContain(`export const TAKE_OVER = "${kit.TAKE_OVER}";`);
    expect(shell).toMatch(/if \(event\.data === TAKE_OVER\) event\.waitUntil\(worker\.skipWaiting\(\)\);/);
  });
});
