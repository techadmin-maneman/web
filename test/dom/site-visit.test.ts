// Where a visitor came from, kept in the browser and reported to the API (site/src/lib/visit.ts; ADR 0288): the first
// landing reported, and again before anything else while the API has given no reference, so a report that never
// arrived cannot make a later plain page the visitor's first touch; once a reference is kept, only a landing a campaign
// put something in is reported.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAttribution, readAttribution, visitorRef } from "../../site/src/lib/visit.ts";

let reported: Record<string, unknown>[];
let answer: () => Response;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function land(path: string) {
  history.replaceState(null, "", path);
  captureAttribution();
  await settle();
  await settle();
}

beforeEach(() => {
  // jsdom's storage: a Node with a localStorage of its own (25 on) hides it. CI's Node (.nvmrc) has none.
  const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
  if (jsdom !== undefined) vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  reported = [];
  answer = () => Response.json({ ref: "7KQ3M9XP" });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (new URL(url, location.origin).pathname === "/api/landings") {
      reported.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>);
    }
    return Promise.resolve(answer());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a visitor's landings", () => {
  it("report the first, keep its reference, and leave a plain page later unreported", async () => {
    await land("/try?gclid=Cj0_test&utm_source=google&utm_medium=cpc");
    await land("/guides");

    expect(reported.map((touch) => touch.gclid ?? touch.landing_path)).toEqual(["Cj0_test"]);
    expect(visitorRef()).toBe("7KQ3M9XP");
    expect(readAttribution()).toMatchObject({ gclid: "Cj0_test" });
  });

  it("report the first landing again, not the plain page, while its report never arrived", async () => {
    answer = () => new Response(null, { status: 503 });
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
});
