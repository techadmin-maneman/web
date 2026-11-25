// The unanswered-lead banner on every console screen (apps/ops/src/frame/LeadBanner.tsx;
// docs/decisions/0323-the-unanswered-lead-alert.md): drawn for a Care person on shift while a lead who wrote waits past
// their alert time, the longest waiting first, with the way to their chat; nothing for anyone off shift. Every name and
// number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitingLead } from "../../apps/ops/src/api.ts";
import { shell } from "../../apps/ops/src/content/shell.ts";
import { LeadBanner } from "../../apps/ops/src/frame/LeadBanner.tsx";
import { phoneWords } from "../../apps/ops/src/lib/phone.ts";
import { indiaClock, indiaDate, shortDate } from "../../packages/web-kit/dates.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const KNOWN: WaitingLead = {
  conversation_id: "cv1",
  person_id: "p1",
  name: "Arjun Mehta",
  mobile: "+919810000001",
  since: "2026-11-26T06:20:00.000Z",
  alert_at: "2026-11-26T06:25:00.000Z",
};

const STRANGER: WaitingLead = {
  conversation_id: "cv2",
  person_id: null,
  name: null,
  mobile: "+919811112222",
  since: "2026-11-25T16:40:00.000Z",
  alert_at: "2026-11-26T04:05:00.000Z",
};

const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/care-laptop";

let page: HTMLDivElement;
let given: unknown[];
let root: Root;
let answer: { on_shift: boolean; leads: WaitingLead[]; push_key: string | null };

async function draw() {
  act(() => {
    root.render(createElement(LeadBanner));
  });
  await answered();
}

/** A time as the banner keeps it, whole on one line. */
const clock = (instant: string) => indiaClock(instant).replace(" ", "\u00a0");

const link = () => page.querySelector("a");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-26T07:00:00.000Z") });
  answer = { on_shift: true, leads: [KNOWN], push_key: null };
  given = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://fake.maneman.test").pathname;
      // Who is signed in is read as the bar opens; nobody, here, so the API decides.
      if (path === "/api/whoami") {
        return Promise.resolve(Response.json({ error: { code: "internal_error", request_id: "r" } }, { status: 500 }));
      }
      if (path === "/api/leads/waiting") return Promise.resolve(Response.json(answer));
      if (path === "/api/leads/alerts-phone") {
        given.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return undefined;
    }),
  );
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
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the lead banner", () => {
  it("names the lead waiting by the time today, and opens their chat", async () => {
    await draw();
    expect(page.textContent).toContain(shell.leads.title(1, clock(KNOWN.since)));
    expect(page.textContent).toContain(shell.leads.wrote("Arjun Mehta", phoneWords(KNOWN.mobile)));
    expect(link()?.getAttribute("href")).toContain("/messages");
    expect(link()?.getAttribute("href")).toContain("cv1");
    expect(link()?.getAttribute("aria-label") ?? link()?.textContent).toContain(shell.leads.openChat);
  });

  it("counts the leads waiting, names a wait from an earlier day by its day, and a stranger by their number", async () => {
    answer = { ...answer, leads: [STRANGER, KNOWN] };
    await draw();
    const since = `${shortDate(indiaDate(STRANGER.since)).replaceAll(" ", " ")}, ${clock(STRANGER.since)}`;
    expect(page.textContent).toContain(shell.leads.title(2, since));
    expect(page.textContent).toContain(shell.leads.wrote(null, phoneWords(STRANGER.mobile)));
    expect(link()?.getAttribute("href")).toContain("cv2");
  });

  it("is drawn for nobody off shift, and for nobody with no lead waiting", async () => {
    answer = { ...answer, on_shift: false };
    await draw();
    expect(page.textContent).toBe("");
    answer = { ...answer, on_shift: true, leads: [] };
    act(() => {
      root.unmount();
    });
    root = createRoot(page);
    await draw();
    expect(page.textContent).toBe("");
  });

  it("registers the console's worker again where the browser let it go, and gives the device's address anew", async () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("Notification", { permission: "granted" });
    // Only its presence is read: whether this browser can take pushes at all.
    vi.stubGlobal("PushManager", {});
    const registered: string[] = [];
    const registration = {
      pushManager: {
        getSubscription: () => Promise.resolve(null),
        subscribe: () => Promise.resolve({ endpoint: ENDPOINT, options: { applicationServerKey: null } }),
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve(registration),
        getRegistration: () => Promise.resolve(undefined),
        register: (url: string) => {
          registered.push(url);
          return Promise.resolve(registration);
        },
      },
    });
    answer = { ...answer, push_key: KEY };
    await draw();
    await act(async () => {
      await answered();
    });
    expect(registered).toEqual(["/sw.js"]);
    expect(given).toEqual([{ endpoint: ENDPOINT }]);
  });
});
