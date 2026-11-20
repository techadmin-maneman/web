// Where a visitor came from, kept in the browser and reported to the API (site/src/lib/visit.ts; ADR 0288): the first
// landing reported, and again before anything else while the API has given no reference, so a report that never
// arrived cannot make a later plain page the visitor's first touch; once a reference is kept, only a landing a campaign
// put something in is reported. A Decline on the cookie bar is kept until the API has heard it, and sent again first.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAttribution, readAttribution, reportDeclined, visitorRef } from "../../site/src/lib/visit.ts";
import { contractChecked } from "./contract-fetch.ts";
import { answered } from "./render-hook.ts";

let reported: Record<string, unknown>[];
/** Whether each landing report was sent to outlive its page. */
let keptAlive: boolean[];
let answer: () => Response | Promise<Response>;
let declines: number;
let declineAnswer: () => Response;

async function land(path: string) {
  history.replaceState(null, "", path);
  captureAttribution();
  await answered();
  await answered();
}

beforeEach(() => {
  // jsdom's storage: a Node with a localStorage of its own (25 on) hides it. CI's Node (.nvmrc) has none.
  const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
  if (jsdom !== undefined) vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  reported = [];
  keptAlive = [];
  declines = 0;
  answer = () => Response.json({ ref: "7KQ3M9XP" });
  declineAnswer = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    "fetch",
    contractChecked("public", (url: string, init?: { body?: unknown; keepalive?: boolean }) => {
      if (new URL(url, location.origin).pathname === "/api/landings/declined") {
        declines += 1;
        return declineAnswer();
      }
      if (new URL(url, location.origin).pathname === "/api/landings") {
        reported.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>);
        keptAlive.push(init?.keepalive === true);
      }
      return answer();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The page still loading, until `loaded()`. */
const loading = () => vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

async function loaded(readyState: ReturnType<typeof loading>) {
  readyState.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
  await answered();
  await answered();
}

describe("a visitor's landings", () => {
  it("report the first, keep its reference, and leave a plain page later unreported", async () => {
    await land("/try?gclid=Cj0_test&utm_source=google&utm_medium=cpc");
    await land("/guides");

    expect(reported.map((touch) => touch.gclid ?? touch.landing_path)).toEqual(["Cj0_test"]);
    expect(visitorRef()).toBe("7KQ3M9XP");
    expect(readAttribution()).toMatchObject({ gclid: "Cj0_test" });
  });

  it("are kept at once but reported only once the page has loaded, so no report holds up its first paint", async () => {
    const readyState = loading();
    history.replaceState(null, "", "/r/PREVIEW1?utm_source=whatsapp");
    captureAttribution();
    await answered();

    expect(readAttribution()).toMatchObject({ utm_source: "whatsapp" });
    expect(reported).toEqual([]);

    await loaded(readyState);
    expect(reported.map((touch) => touch.utm_source)).toEqual(["whatsapp"]);
  });

  it("wait for the browser to be free once the page has loaded, at most three seconds", async () => {
    let free: (() => void) | undefined;
    const idle = vi.fn((run: () => void, options: { timeout: number }) => {
      free = run;
      expect(options).toEqual({ timeout: 3000 });
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    history.replaceState(null, "", "/try?utm_source=google&utm_medium=cpc");
    captureAttribution();
    await answered();

    expect(idle).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([]);
    free?.();
    await answered();
    expect(reported.map((touch) => touch.utm_source)).toEqual(["google"]);
  });

  it("go after three seconds where an ad tag holds the page's load up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    loading();
    history.replaceState(null, "", "/try?utm_source=google&utm_medium=cpc");
    captureAttribution();
    await vi.advanceTimersByTimeAsync(2999);
    expect(reported).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    expect(reported.map((touch) => touch.utm_source)).toEqual(["google"]);
  });

  it("go as the page does, outliving it, where the visitor leaves before it has loaded", async () => {
    loading();
    history.replaceState(null, "", "/book?utm_source=meta&utm_medium=paid_social");
    captureAttribution();
    window.dispatchEvent(new Event("pagehide"));
    await answered();

    expect(reported.map((touch) => touch.utm_source)).toEqual(["meta"]);
    expect(keptAlive).toEqual([true]);
  });

  it("send a returning visitor's campaign landing lost on one page from the next", async () => {
    await land("/");
    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await land("/book?utm_source=meta&utm_medium=paid_social&fbclid=IwAR_test");
    answer = () => Response.json({ ref: "7KQ3M9XP" });
    await land("/guides");
    await land("/try");

    expect(reported.map((touch) => touch.utm_source ?? touch.landing_path)).toEqual(["/", "meta", "meta"]);
  });

  it("report the first landing again, not the plain page, while its report never arrived", async () => {
    // The report never arrives: the browser is offline.
    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await land("/try?gclid=Cj0_test");
    answer = () => Response.json({ ref: "7KQ3M9XP" });
    await land("/guides");

    expect(reported.map((touch) => [touch.landing_path, touch.gclid])).toEqual([
      ["/try", "Cj0_test"],
      ["/try", "Cj0_test"],
    ]);
    expect(visitorRef()).toBe("7KQ3M9XP");
  });

  it("report a campaign's landing later, the latest kept as the last touch", async () => {
    await land("/");
    await land("/book?utm_source=meta&utm_medium=paid_social&fbclid=IwAR_test");

    expect(reported).toHaveLength(2);
    expect(readAttribution()).toMatchObject({ utm_source: "meta", fbclid: "IwAR_test" });
  });

  it("send a Decline the API never heard again first, from the next page, and once it has, no more", async () => {
    await land("/");
    declineAnswer = () => {
      throw new TypeError("Failed to fetch");
    };
    await reportDeclined();
    declineAnswer = () => new Response(null, { status: 204 });
    await land("/guides");
    await land("/try");

    expect(declines).toBe(2);
  });

  it("send a Decline left from an earlier page at once, before the page has loaded and its reports go", async () => {
    localStorage.setItem("mm_decline_unsent", "1");
    const readyState = loading();
    history.replaceState(null, "", "/?utm_source=google&utm_medium=cpc");
    captureAttribution();
    await answered();

    expect(declines).toBe(1);
    expect(reported).toEqual([]);
    await loaded(readyState);
    expect(reported).toHaveLength(1);
    expect(declines).toBe(1);
  });

  it("wait for a landing report going now, so the API blanks what it keeps too", async () => {
    let arrive: (() => void) | undefined;
    answer = () =>
      new Promise<Response>((resolve) => {
        arrive = () => {
          resolve(Response.json({ ref: "7KQ3M9XP" }));
        };
      });
    history.replaceState(null, "", "/?fbclid=IwAR_test");
    captureAttribution();
    await answered();
    expect(reported).toHaveLength(1);

    const declining = reportDeclined();
    await answered();
    expect(declines).toBe(0);
    arrive?.();
    await declining;
    expect(declines).toBe(1);
  });
});
