// A Decline on the cookie bar and a Meta Pixel already running on the page (site/src/lib/analytics.ts; ADR 0288):
// consent starts granted, so a production page may have started the Pixel before the visitor answers. A Decline
// revokes its consent and Meta is sent no more events from the page; an Accept grants it again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerConsent, track } from "../../site/src/lib/analytics.ts";

let fbq: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom's storage: a Node with a localStorage of its own (25 on) hides it. CI's Node (.nvmrc) has none.
  const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
  if (jsdom !== undefined) vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  fbq = vi.fn();
  Reflect.set(window, "fbq", fbq);
  Reflect.set(window, "dataLayer", []);
});

afterEach(() => {
  Reflect.deleteProperty(window, "fbq");
  vi.unstubAllGlobals();
});

describe("a Meta Pixel already running", () => {
  it("is revoked at a Decline and sent nothing more, then granted again at an Accept", () => {
    answerConsent("denied");
    expect(fbq).toHaveBeenCalledWith("consent", "revoke");

    track({ name: "call_click", page_path: "/" });
    expect(fbq.mock.calls.filter(([command]) => command !== "consent")).toEqual([]);

    answerConsent("granted");
    expect(fbq).toHaveBeenCalledWith("consent", "grant");
    track({ name: "call_click", page_path: "/" });
    expect(fbq).toHaveBeenCalledWith("track", "Contact");
  });
});
