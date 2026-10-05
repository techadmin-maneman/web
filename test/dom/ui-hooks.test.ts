// The hooks every app's screens are built on (packages/ui): one thing at a time on a double tap, an async read that
// always settles, and a page's load with "Try again".

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAsync, valueOr } from "../../packages/ui/useAsync.ts";
import { useLoad } from "../../packages/ui/useLoad.ts";
import { useOneAtATime } from "../../packages/ui/useOneAtATime.ts";
import { renderHook, settled, type Rendered } from "./render-hook.ts";

const mounted: Rendered<unknown>[] = [];
const render = <T, P = undefined>(hook: (props: P) => T, props?: P) => {
  const rendered = renderHook(hook, props);
  mounted.push(rendered);
  return rendered;
};

afterEach(() => {
  for (const rendered of mounted.splice(0)) rendered.unmount();
});

/** A promise and the hands that settle it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("one thing at a time", () => {
  it("runs a second tap's work only once the first has finished, and says it is busy meanwhile", async () => {
    const hook = render(() => useOneAtATime());
    const first = deferred<undefined>();
    let runs = 0;
    const work = async () => {
      runs += 1;
      await first.promise;
    };

    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = hook.current()[1](work);
      void hook.current()[1](work);
    });
    expect(runs).toBe(1);
    expect(hook.current()[0]).toBe(true);

    await act(async () => {
      first.resolve(undefined);
      await running;
    });
    expect(hook.current()[0]).toBe(false);
  });

  it("is free again after work that threw", async () => {
    const hook = render(() => useOneAtATime());
    await act(async () => {
      await hook
        .current()[1](() => Promise.reject(new Error("no signal")))
        .catch(() => undefined);
    });
    expect(hook.current()[0]).toBe(false);
  });
});

describe("an async read", () => {
  it("is pending, then done with its value", async () => {
    const read = deferred<number>();
    const reader = () => read.promise;
    const hook = render(() => useAsync(reader));
    expect(hook.current()[0]).toEqual({ state: "pending" });
    read.resolve(7);
    await settled();
    expect(valueOr(hook.current()[0], 0)).toBe(7);
  });

  // P3-24: a read that rejected left the screen waiting for ever.
  it("settles as failed when it rejects, so no screen waits for ever", async () => {
    const reader = () => Promise.reject(new Error("the store would not open"));
    const hook = render(() => useAsync(reader));
    await settled();
    expect(hook.current()[0]).toMatchObject({ state: "failed" });
    expect(valueOr(hook.current()[0], "nothing")).toBe("nothing");
  });

  it("reads again when what it watches changes, keeping the last answer meanwhile", async () => {
    let calls = 0;
    const reader = () => Promise.resolve((calls += 1));
    const hook = render((watch: number) => useAsync(reader, watch), 1);
    await settled();
    expect(valueOr(hook.current()[0], 0)).toBe(1);

    hook.rerender(2);
    expect(valueOr(hook.current()[0], 0)).toBe(1);
    await settled();
    expect(valueOr(hook.current()[0], 0)).toBe(2);
  });
});

describe("a page's load", () => {
  it("is the API's answer, a not-found apart from any other failure, and loads again on retry", async () => {
    let answer: { ok: true; body: string } | { ok: false; status: number; requestId: string | null } = {
      ok: false,
      status: 404,
      requestId: "r1",
    };
    const load = () => Promise.resolve(answer);
    const hook = render(() => useLoad(load));
    await settled();
    expect(hook.current()[0]).toEqual({ state: "failed", notFound: true, requestId: "r1" });

    answer = { ok: true, body: "the visits" };
    act(() => {
      hook.current()[1]();
    });
    expect(hook.current()[0]).toEqual({ state: "loading" });
    await settled();
    expect(hook.current()[0]).toEqual({ state: "loaded", value: "the visits" });
  });

  it("fails as unanswered when its call throws", async () => {
    const load = () => Promise.reject(new TypeError("Failed to fetch"));
    const hook = render(() => useLoad(load));
    await settled();
    expect(hook.current()[0]).toEqual({ state: "failed", notFound: false, requestId: null });
  });

  it("keeps its answer's identity from one render to the next", async () => {
    const load = () => Promise.resolve({ ok: true as const, body: 1 });
    const hook = render((_render: number) => useLoad(load), 0);
    await settled();
    const first = hook.current()[0];
    hook.rerender(1);
    expect(hook.current()[0]).toBe(first);
  });
});
