// The client app's one way to the API (apps/app/src/api.ts): what a 401 sets
// off, what an answer that is not the API's counts as, how long a call waits,
// and whose clock a hold is counted on (apps/app/src/lib/clock.ts).

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onSessionEnded, putCard } from "../../../apps/app/src/api.ts";
import { apiNow } from "../../../apps/app/src/lib/clock.ts";

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
  it("tells the app the session has ended, whichever call met it", async () => {
    let heard = 0;
    const stop = onSessionEnded(() => (heard += 1));
    answering(() => json(401, { error: { code: "unauthenticated", request_id: "t" } }));

    const answer = await api.payments();
    stop();

    expect(answer).toMatchObject({ ok: false, status: 401, code: "unauthenticated" });
    expect(heard).toBe(1);
  });

  it("says nothing of the kind for any other refusal", async () => {
    let heard = 0;
    const stop = onSessionEnded(() => (heard += 1));
    answering(() => json(404, { error: { code: "not_found", request_id: "t" } }));
    await api.visit("a");
    stop();
    expect(heard).toBe(0);
  });
});

describe("the building search", () => {
  // Each answer spends from Google's budget, so the query goes in a POST's body, never in a link.
  it("asks by POST, with what was typed and the search's one token in the body", async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return Promise.resolve(json(200, { suggestions: [], attribution: "Google Maps" }));
    });
    await api.addressSuggestions("Sunrise Greens", "token-1");
    expect(sent).toEqual([
      {
        url: "/api/address/suggestions",
        init: expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ q: "Sunrise Greens", session: "token-1" }),
        }) as RequestInit,
      },
    ]);
  });
});

describe("an answer that is not the API's", () => {
  it("counts as no connection rather than leaving the page loading for ever", async () => {
    // A Wi-Fi sign-in page, answering 200 with HTML in place of the API.
    answering(() => new Response("<html>Log in to the Wi-Fi</html>", { status: 200 }));
    expect(await api.payments()).toMatchObject({ ok: false, status: 0, code: "offline" });
  });
});

// On a stalled signal, Pay, Continue and Cancel stayed busy until the page was reloaded.
describe("a signal that never answers", () => {
  it("is no connection after 15 seconds for a read", async () => {
    neverAnswering();
    const answer = settled(api.visits());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, status: 0, code: "offline" });
  });

  it("is no connection after 20 seconds for a write", async () => {
    neverAnswering();
    const answer = settled(api.cancel("visit-1", "free"));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, status: 0, code: "offline" });
  });

  it("is waited on for a minute while the referral card goes up", async () => {
    neverAnswering();
    const answer = settled(putCard(new Blob(["jpeg"], { type: "image/jpeg" })));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toMatchObject({ ok: false, status: 0, code: "offline" });
  });
});

/** A fetch that never answers until it is given up on, on the test's own clock. */
function neverAnswering(): void {
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
}

/** A call's answer once it has one, so a test can see it has none yet. */
function settled<T>(call: Promise<T>): { value: T | undefined } {
  const seen: { value: T | undefined } = { value: undefined };
  void call.then((value) => {
    seen.value = value;
  });
  return seen;
}

describe("the API's clock", () => {
  const apiTime = Date.parse("2030-09-16T05:00:00Z");

  it("is the one a hold is counted on, when the phone's is minutes out", async () => {
    vi.useFakeTimers({ now: apiTime + 11 * 60_000 });
    answering(() => json(200, {}, { Date: new Date(apiTime).toUTCString() }));
    await api.holdById("a");
    expect(apiNow()).toBe(apiTime);
  });

  it("takes a phone within a second of it at its word, since the header counts whole seconds", async () => {
    vi.useFakeTimers({ now: apiTime + 700 });
    answering(() => json(200, {}, { Date: new Date(apiTime).toUTCString() }));
    await api.holdById("a");
    expect(apiNow()).toBe(apiTime + 700);
  });

  it("is not set by the Home the phone kept, which is as old as the day it was kept", async () => {
    vi.useFakeTimers({ now: apiTime });
    answering(() =>
      json(200, {}, { Date: new Date(apiTime - 3 * 86_400_000).toUTCString(), "Mm-Served-From": "cache" }),
    );
    await api.me();
    expect(apiNow()).toBe(apiTime);
  });
});
