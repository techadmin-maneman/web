// Razorpay Checkout in the client app (apps/app/src/booking/checkout.ts): its
// script loaded once, a load that fails or stalls counted as a failed payment
// (board C6) and tried afresh next time, and Checkout's three endings told
// apart. It had no test at any level (TCD-04). The page is stood in for: a
// script element that loads, fails or never answers, and a Razorpay that
// records what it was opened with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Loader = typeof import("../../../apps/app/src/booking/checkout.ts");

interface FakeScript {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  removed: boolean;
  remove(): void;
}

let scripts: FakeScript[];
let windowStandIn: {
  Razorpay?: unknown;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  location: { origin: string };
};

beforeEach(() => {
  vi.resetModules();
  scripts = [];
  windowStandIn = { setTimeout, clearTimeout, location: { origin: "https://app.maneman.test" } };
  vi.stubGlobal("window", windowStandIn);
  vi.stubGlobal("document", {
    createElement: () => {
      const script: FakeScript = {
        src: "",
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          script.removed = true;
        },
      };
      return script;
    },
    head: {
      append: (script: FakeScript) => {
        scripts.push(script);
      },
    },
    documentElement: {},
  });
  // Checkout is drawn in the page's own ink, read from its stylesheet (DS-19).
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => (name === "--ink" ? " #16233a" : ""),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const checkout = (): Promise<Loader> => import("../../../apps/app/src/booking/checkout.ts");

describe("loading Checkout's script", () => {
  it("loads it once from Razorpay, however many times the pay step asks while it loads", async () => {
    const { loadCheckout } = await checkout();
    const first = loadCheckout();
    const second = loadCheckout();

    expect(scripts.map((script) => script.src)).toEqual(["https://checkout.razorpay.com/v1/checkout.js"]);
    scripts[0]?.onload?.();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it("adds nothing when Checkout is already on the page", async () => {
    windowStandIn.Razorpay = function Razorpay() {
      return undefined;
    };
    const { loadCheckout } = await checkout();
    await loadCheckout();
    expect(scripts).toEqual([]);
  });

  it("fails a script that does not load, takes it away, and tries afresh the next time", async () => {
    const { loadCheckout } = await checkout();
    const first = loadCheckout();
    scripts[0]?.onerror?.();

    await expect(first).rejects.toThrow("Checkout did not load");
    expect(scripts[0]?.removed).toBe(true);
    void loadCheckout();
    expect(scripts).toHaveLength(2);
  });

  it("gives up on a script still not loaded after fifteen seconds, as a failed payment", async () => {
    vi.useFakeTimers();
    windowStandIn.setTimeout = setTimeout;
    windowStandIn.clearTimeout = clearTimeout;
    const { loadCheckout } = await checkout();
    const stalled = loadCheckout();
    const outcome = expect(stalled).rejects.toThrow("Checkout did not load");

    await vi.advanceTimersByTimeAsync(14_999);
    expect(scripts[0]?.removed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(scripts[0]?.removed).toBe(true);
  });
});

describe("paying in Checkout", () => {
  const ORDER = {
    key_id: "rzp_test_abc",
    order_id: "order_9",
    amount: 200000,
    currency: "INR" as const,
    name: "Mane Man",
    description: "Service visit · Sun 27 Sep",
    prefill: { name: "Rohit Malhotra", contact: "+919810000001" },
  };

  /** A Razorpay that keeps what it was opened with, and lets the test end it as the client would. */
  function standInRazorpay() {
    const opened: Record<string, unknown>[] = [];
    let failed: (() => void) | null = null;
    windowStandIn.Razorpay = class {
      constructor(options: Record<string, unknown>) {
        opened.push(options);
      }
      on(_event: string, handler: () => void) {
        failed = handler;
      }
      open() {
        return undefined;
      }
    };
    const options = () => opened.at(-1) as { handler: () => void; modal: { ondismiss: () => void } };
    return { opened, options, fail: () => failed?.() };
  }

  /** The hold's last moment for a payment to count, twelve minutes from now. */
  const payBy = () => new Date(Date.now() + 12 * 60_000).toISOString();

  it("counts it as failed when Checkout never arrived", async () => {
    const { pay } = await checkout();
    expect(await pay(ORDER, payBy())).toBe("failed");
  });

  // MON-42, UX-13: Checkout was headed by a letter "M" where the brand mark belongs.
  it("opens on our order, under the brand mark on ink, with Checkout's own retry off", async () => {
    const razorpay = standInRazorpay();
    const { pay } = await checkout();
    const paying = pay(ORDER, payBy());

    expect(razorpay.opened[0]).toMatchObject({
      key: "rzp_test_abc",
      order_id: "order_9",
      amount: 200000,
      currency: "INR",
      prefill: { name: "Rohit Malhotra", contact: "+919810000001" },
      retry: { enabled: false },
      theme: { color: "#16233a" },
      image: "https://app.maneman.test/icon-512.png",
    });
    razorpay.options().handler();
    expect(await paying).toBe("paid");
  });

  // MON-44: Checkout ignores a method chosen beforehand unless it is also given an e-mail, which we never send, so
  // the app's "UPI · any app" was a choice that did nothing. Checkout lists its own ways to pay.
  it("chooses no way to pay for the client, leaving Checkout to list them", async () => {
    const razorpay = standInRazorpay();
    const { pay } = await checkout();
    void pay(ORDER, payBy());

    const prefill = razorpay.opened[0]?.prefill as Record<string, unknown>;
    expect(prefill).not.toHaveProperty("method");
    expect(prefill).not.toHaveProperty("email");
  });

  it("tells a window the client closed from a payment that failed", async () => {
    const razorpay = standInRazorpay();
    const { pay } = await checkout();

    const closed = pay(ORDER, payBy());
    razorpay.options().modal.ondismiss();
    expect(await closed).toBe("dismissed");

    const refused = pay(ORDER, payBy());
    razorpay.fail();
    expect(await refused).toBe("failed");
  });

  // A payment Checkout took after the hold's grace would be refused and refunded (MON-03).
  it("takes no payment once it would be too late to keep the hold", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-21T06:30:00.000Z") });
    windowStandIn.setTimeout = setTimeout;
    windowStandIn.clearTimeout = clearTimeout;
    const razorpay = standInRazorpay();
    const { pay } = await checkout();
    void pay(ORDER, "2026-09-21T06:42:00.000Z");
    expect(razorpay.opened[0]).toMatchObject({ timeout: 720 });
  });

  it("counts Checkout as closed when it has not closed itself ten seconds after its time is up", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-21T06:30:00.000Z") });
    windowStandIn.setTimeout = setTimeout;
    windowStandIn.clearTimeout = clearTimeout;
    standInRazorpay();
    const { pay } = await checkout();
    let outcome: string | null = null;
    void pay(ORDER, "2026-09-21T06:31:00.000Z").then((answer) => {
      outcome = answer;
    });

    await vi.advanceTimersByTimeAsync(69_999);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("dismissed");
  });
});
