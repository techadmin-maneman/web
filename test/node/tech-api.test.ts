// The technician app's one way to the API (apps/tech/src/api.ts): what a 401
// sets off, when a call gives up on a signal that never answers, and what the
// app is told about whether anything answered at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onReach, onSessionEnded } from "../../apps/tech/src/api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function answering(response: () => Response) {
  vi.stubGlobal("fetch", () => Promise.resolve(response()));
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("a 401", () => {
  it("tells the app the session has ended, with the API's code, whichever call met it", async () => {
    const heard: string[] = [];
    const stop = onSessionEnded((code) => heard.push(code));
    answering(() => json(401, { error: { code: "device_revoked", request_id: "t" } }));

    const answer = await api.job("a");
    stop();

    expect(answer).toMatchObject({ ok: false, status: 401, code: "device_revoked" });
    expect(heard).toEqual(["device_revoked"]);
  });

  it("says nothing of the kind for any other refusal", async () => {
    const heard: string[] = [];
    const stop = onSessionEnded((code) => heard.push(code));
    answering(() => json(404, { error: { code: "not_found", request_id: "t" } }));
    await api.job("a");
    stop();
    expect(heard).toEqual([]);
  });
});

describe("an answer that is not the API's", () => {
  it("counts as no signal rather than leaving the screen loading for ever", async () => {
    // A Wi-Fi sign-in page, answering 200 with HTML in place of the API.
    answering(() => new Response("<html>Log in to the Wi-Fi</html>", { status: 200 }));
    expect(await api.jobs("2030-09-01")).toMatchObject({ ok: false, status: 0, code: "offline" });
  });
});

describe("a signal that never answers", () => {
  it("is given up on, and counts as no signal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("gave up", "AbortError"));
          });
        }),
    );
    const answer = api.me();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await answer).toMatchObject({ ok: false, code: "offline" });
  });
});

describe("whether anything answered", () => {
  const listen = () => {
    const heard: boolean[] = [];
    return { heard, stop: onReach((reached) => heard.push(reached)) };
  };

  it("is yes when the API answered, even with a refusal", async () => {
    const { heard, stop } = listen();
    answering(() => json(404, { error: { code: "not_found", request_id: "t" } }));
    await api.job("a");
    stop();
    expect(heard).toEqual([true]);
  });

  it("is no when nothing did", async () => {
    const { heard, stop } = listen();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await api.me();
    stop();
    expect(heard).toEqual([false]);
  });

  it("is no when the day came from the service worker's copy, which is still the day", async () => {
    const { heard, stop } = listen();
    answering(() => json(200, { date: "2030-09-01", jobs: [] }, { "Mm-Served-From": "cache" }));
    const answer = await api.jobs("2030-09-01");
    stop();
    expect(answer).toMatchObject({ ok: true, body: { date: "2030-09-01", jobs: [] } });
    expect(heard).toEqual([false]);
  });
});
