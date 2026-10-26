// Who acts in the timelapse. A Wire is a person's app talking to the API as the app does, with the app's host, origin
// and session cookie, for the volume months of business need (most clients, most visits). A Phone is a browser
// context on the sim's clock, for every workflow a wave walks through on screen; a Wire's session can be carried
// into one, so a client seen on the wire can open the app signed in.

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { contractErrors, type Surface } from "../contract.ts";
import { clockHeaders, simNow, type SimClock } from "./sim.ts";
import { API, APP, LOGIN_CODE, OPS, PORTS, SITE, TECH, TURNSTILE } from "./stack.ts";
import type { AppName, Steps } from "./steps.ts";

export interface Answer<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Record<string, string>;
}

const HOSTS = {
  app: { host: `app.localhost:${String(PORTS.app)}`, origin: APP, surface: "client" },
  ops: { host: `ops.localhost:${String(PORTS.ops)}`, origin: OPS, surface: "ops" },
  tech: { host: `tech.localhost:${String(PORTS.tech)}`, origin: TECH, surface: "tech" },
  site: { host: `127.0.0.1:${String(PORTS.api)}`, origin: API, surface: "public" },
} as const satisfies Record<string, { host: string; origin: string; surface: Surface }>;

type WireApp = keyof typeof HOSTS;

/** One person's app on the wire: its host, its cookies, and every answer held to the API's contract. */
export class Wire {
  private readonly cookies = new Map<string, string>();

  readonly app: WireApp;
  private readonly steps: Steps;
  /** For the console: the member of staff it calls as, locally (src/http/access.ts). */
  private readonly staff: string | undefined;

  constructor(app: WireApp, steps: Steps, staff?: string) {
    this.app = app;
    this.steps = steps;
    this.staff = staff;
  }

  /** Signs the person in again: a session runs out, and the app then sends them back to its sign-in. */
  reauth: (() => Promise<boolean>) | undefined;
  /** How often the session ran out and was signed in again. */
  reauths = 0;

  /** The session cookie, to carry into a browser. */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Answer<T>> {
    const answer = await this.send<T>(method, path, body, headers);
    if (answer.status !== 401 || this.reauth === undefined || path.includes("/auth/")) return answer;
    if (!(await this.reauth())) return answer;
    this.reauths += 1;
    return this.send<T>(method, path, body, headers);
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Answer<T>> {
    const { host, origin, surface } = HOSTS[this.app];
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const sent: Record<string, string> = {
      Host: host,
      Origin: origin,
      Accept: "application/json",
      ...clockHeaders(),
      ...(this.staff === undefined ? {} : { "X-Dev-Staff": this.staff }),
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      ...(this.cookies.size > 0
        ? { Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") }
        : {}),
      ...headers,
    };
    const answer = await new Promise<{ status: number; text: string; headers: Record<string, string | string[]> }>(
      (resolve, reject) => {
        const outgoing = httpRequest(
          { host: "127.0.0.1", port: PORTS.api, path, method, headers: sent },
          (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
            incoming.on("end", () => {
              resolve({
                status: incoming.statusCode ?? 0,
                text: Buffer.concat(chunks).toString("utf8"),
                headers: incoming.headers as Record<string, string | string[]>,
              });
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.setTimeout(30_000, () => outgoing.destroy(new Error(`${method} ${path} timed out`)));
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
      },
    );
    for (const line of [answer.headers["set-cookie"] ?? []].flat()) {
      const [pair = ""] = line.split(";");
      const [name = "", ...value] = pair.split("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.join("="));
    }
    let parsed: unknown = answer.text;
    try {
      parsed = answer.text === "" ? null : JSON.parse(answer.text);
    } catch {
      // Not JSON: kept as text.
    }
    const where = `${method} ${path.split("?")[0] ?? path}`;
    if (answer.status >= 500) {
      this.steps.report({
        kind: "http",
        app: this.app,
        status: answer.status,
        url: where,
        message: `${where} ${String(answer.status)} ${answer.text.slice(0, 300)}`,
      });
    }
    if (typeof parsed === "object" && parsed !== null) {
      for (const error of contractErrors(surface, method, path.split("?")[0] ?? path, answer.status, parsed).slice(
        0,
        3,
      )) {
        this.steps.report({
          kind: "contract",
          app: this.app,
          url: where,
          status: answer.status,
          message: error.slice(0, 600),
        });
      }
    }
    const flat = Object.fromEntries(
      Object.entries(answer.headers).map(([key, value]) => [key, [value].flat().join(", ")]),
    );
    return { status: answer.status, body: parsed as T, headers: flat };
  }

  /** As call, but throws unless the answer is a success: for a step that needs what it made. */
  async must<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const answer = await this.call<T>(method, path, body, headers);
    if (answer.status >= 400) {
      throw new Error(
        `${method} ${path} answered ${String(answer.status)}: ${JSON.stringify(answer.body).slice(0, 400)}`,
      );
    }
    return answer.body;
  }
}

/** A step's write: the event ID and the job's start the technician app sends with every step. */
export const stepHeaders = (startsAt: string): Record<string, string> => ({
  "X-Client-Event-Id": randomUUID(),
  "X-Job-Starts-At": startsAt,
});

/** Signs a client in on the wire, with the local code, as the app's two screens do. */
export async function clientSignIn(wire: Wire, mobile: string): Promise<boolean> {
  wire.reauth ??= () => clientSignIn(wire, mobile);
  const sent = await wire.call<{ challenge_id: string }>("POST", "/api/auth/otp", {
    mobile,
    turnstile_token: TURNSTILE,
  });
  if (sent.status !== 202) return false;
  const verified = await wire.call<{ verified: boolean }>("POST", "/api/auth/verify", {
    challenge_id: sent.body.challenge_id,
    code: LOGIN_CODE,
  });
  return verified.status === 200 && verified.body.verified;
}

/** Signs a technician in on the wire from a phone of their own. */
export async function techSignIn(wire: Wire, mobile: string, deviceId: string): Promise<boolean> {
  wire.reauth ??= () => techSignIn(wire, mobile, deviceId);
  const sent = await wire.call<{ challenge_id: string }>("POST", "/api/tech/auth/otp", { mobile, device_id: deviceId });
  if (sent.status !== 202) return false;
  const verified = await wire.call<{ verified: boolean }>("POST", "/api/tech/auth/verify", {
    challenge_id: sent.body.challenge_id,
    code: LOGIN_CODE,
    device_id: deviceId,
  });
  return verified.status === 200 && verified.body.verified;
}

/** The secret the local API checks Razorpay's webhook with: the example's, which .dev.vars copies. */
function webhookSecret(): string {
  const text = readFileSync(".dev.vars", "utf8");
  return /^RAZORPAY_WEBHOOK_SECRET=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
}

/** Razorpay telling the API a payment was captured for an order, signed as Razorpay signs it. */
export async function razorpayPaid(
  order: { order_id: string; amount: number },
  notes: Record<string, string>,
  method: "upi" | "card" = "upi",
): Promise<number> {
  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: `pay_tl_${randomUUID().slice(0, 12)}`,
          entity: "payment",
          amount: order.amount,
          currency: "INR",
          status: "captured",
          order_id: order.order_id,
          method,
          vpa: "timelapse@upi",
          notes,
          created_at: Math.floor(simNow() / 1000),
        },
      },
    },
  });
  const answer = await fetch(`${API}/api/hooks/razorpay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": createHmac("sha256", webhookSecret()).update(body).digest("hex"),
      "X-Razorpay-Event-Id": `evt_tl_${randomUUID()}`,
      ...clockHeaders(),
    },
    body,
  });
  return answer.status;
}

/** A browser context on the sim's clock, for one person, with every page watched. */
export class Phone {
  readonly app: AppName;
  readonly context: BrowserContext;
  readonly page: Page;

  private constructor(app: AppName, context: BrowserContext, page: Page) {
    this.app = app;
    this.context = context;
    this.page = page;
  }

  static async open(
    browser: Browser,
    clock: SimClock,
    steps: Steps,
    app: AppName,
    options: { onClock?: boolean; mobile?: boolean; staff?: string } = {},
  ): Promise<Phone> {
    const mobile = options.mobile ?? app !== "ops";
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
      permissions: app === "tech" ? ["camera", "geolocation"] : [],
      geolocation: app === "tech" ? { latitude: 28.4598, longitude: 77.0268, accuracy: 12 } : undefined,
    });
    context.setDefaultTimeout(8_000);
    // The stand-ins every page needs from outside: Turnstile hands out the dummy token, Razorpay's Checkout pays at
    // once (the run then sends the webhook Razorpay would), and no map or font CDN is waited on.
    await context.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `(() => { let o; const issue = () => setTimeout(() => o.callback(${JSON.stringify(TURNSTILE)}), 20);
          window.turnstile = { render(c, g) { o = g; issue(); return "fake"; }, reset() { issue(); }, remove() {} }; })();`,
      }),
    );
    await context.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.Razorpay = function (options) { this.on = () => {};
          this.open = () => { window.__checkout = options; setTimeout(() => options.handler({ razorpay_payment_id: "pay_tl" }), 50); }; };`,
      }),
    );
    await context.route(/^https:\/\/(cdn\.razorpay\.com|maps\.googleapis\.com|maps\.gstatic\.com)\//, (route) =>
      route.abort(),
    );
    if (options.onClock !== false) await clock.adopt(context);
    await clock.tell(context, options.staff === undefined ? {} : { "X-Dev-Staff": options.staff });
    steps.watch(context, app);
    const page = await context.newPage();
    return new Phone(app, context, page);
  }

  get origin(): string {
    return { app: APP, ops: OPS, tech: TECH, site: SITE, worker: API }[this.app];
  }

  /** Opens a path of this app. */
  async go(path: string): Promise<void> {
    await this.page.goto(`${this.origin}${path}`);
  }

  /** The page's own fetch, from its origin, with its cookies: what the screen's code would send. */
  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Answer<T>> {
    if (!this.page.url().startsWith(this.origin)) await this.go("/");
    return this.page.evaluate(
      async ({ method, path, body, headers }) => {
        const answer = await fetch(path, {
          method,
          headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await answer.text();
        let parsed: unknown = text;
        try {
          parsed = text === "" ? null : JSON.parse(text);
        } catch {
          // Not JSON.
        }
        return { status: answer.status, body: parsed, headers: {} };
      },
      { method, path, body, headers },
    ) as Promise<Answer<T>>;
  }

  async must<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const answer = await this.call<T>(method, path, body, headers);
    if (answer.status >= 400) {
      throw new Error(
        `${method} ${path} answered ${String(answer.status)}: ${JSON.stringify(answer.body).slice(0, 400)}`,
      );
    }
    return answer.body;
  }

  /** Carries a wire's session into this browser, so the person opens the app already signed in. */
  async carry(wire: Wire, cookie: string): Promise<void> {
    const value = wire.cookie(cookie);
    if (value === undefined) throw new Error(`the wire holds no ${cookie} cookie`);
    await this.context.clearCookies();
    await this.context.addCookies([
      { name: cookie, value, url: this.origin, secure: true, httpOnly: true, sameSite: "Lax" },
    ]);
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}
