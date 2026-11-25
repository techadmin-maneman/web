// Turning a Care person's lead alerts on for the device in hand (apps/ops/src/care/PhoneAlerts.tsx,
// apps/ops/src/lib/lead-push.ts; docs/decisions/0323-the-unanswered-lead-alert.md): the tap registers the console's
// worker, asks the browser, subscribes and gives the address to the API; the answer is said where the button was, and
// focus stays there. The browser's push parts are stand-ins, and the push address is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneAlerts } from "../../apps/ops/src/care/PhoneAlerts.tsx";
import { care } from "../../apps/ops/src/content/care.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/care-phone";
const copy = care.team.alerts;

let page: HTMLDivElement;
let root: Root;
let given: unknown[];
let registered: string[];

function browser(answer: NotificationPermission) {
  vi.stubGlobal("Notification", { permission: "default", requestPermission: () => Promise.resolve(answer) });
  // Only its presence is read: whether this browser can take pushes at all.
  vi.stubGlobal("PushManager", {});
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
      register: (url: string) => {
        registered.push(url);
        return Promise.resolve(registration);
      },
      getRegistration: () => Promise.resolve(undefined),
    },
  });
}

async function draw() {
  act(() => {
    root.render(createElement(PhoneAlerts));
  });
  await answered();
}

const turnOn = () =>
  [...page.querySelectorAll("button")].find((each) =>
    (each.getAttribute("aria-label") ?? each.textContent).includes(copy.turnOn),
  );

beforeEach(() => {
  given = [];
  registered = [];
  vi.stubEnv("PROD", true);
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://fake.maneman.test").pathname;
      if (path === "/api/leads/waiting")
        return Promise.resolve(Response.json({ on_shift: true, leads: [], push_key: KEY }));
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
});

describe("lead alerts on this device", () => {
  it("are turned on from the tap: the worker registered, the address given, and the answer said in place", async () => {
    browser("granted");
    await draw();
    const button = turnOn();
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await answered();
    });
    expect(registered).toEqual(["/sw.js"]);
    expect(given).toEqual([{ endpoint: ENDPOINT }]);
    const said = page.querySelector('[role="status"]');
    expect(said?.textContent).toBe(copy.on);
    expect(document.activeElement).toBe(said?.parentElement);
    expect(turnOn()).toBeUndefined();
  });

  it("say so when the browser refuses them, and give nothing to the API", async () => {
    browser("denied");
    await draw();
    await act(async () => {
      turnOn()?.click();
      await answered();
    });
    expect(page.querySelector('[role="status"]')?.textContent).toBe(copy.blocked);
    expect(given).toEqual([]);
  });
});
