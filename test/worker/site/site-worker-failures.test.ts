// What the mm-site Worker does when answering a page goes wrong in a way it does not expect (site/src/worker.ts): one
// line in its log, a report to mm-api as a page's own script error is, which mm-api takes on to Sentry, and the page as
// built for the visitor where the assets can still give it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSiteWorker, type SiteEnv } from "../../../site/src/worker.ts";
import { PAGE } from "./site-worker-fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Worker's bindings: the assets fail their first answer, and mm-api keeps every report it is sent. */
function failingOnce() {
  const reports: Request[] = [];
  let asked = 0;
  const env: SiteEnv = {
    ASSETS: {
      fetch: () => {
        asked += 1;
        if (asked === 1) return Promise.reject(new TypeError("the assets went away"));
        return Promise.resolve(new Response(PAGE, { headers: { "Content-Type": "text/html" } }));
      },
    } as unknown as Fetcher,
    API: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        reports.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    } as unknown as Fetcher,
  };
  return { env, reports };
}

/** A run's context, its sends kept so the test can wait for them. */
function context() {
  const kept: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => kept.push(promise),
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(kept) };
}

describe("a page the Worker could not answer", () => {
  it("is served as built, logged, and reported to mm-api as a page's script error is", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, reports } = failingOnce();
    const { ctx, settled } = context();

    const page = await createSiteWorker().fetch(new Request("https://maneman.in/how-it-works"), env, ctx);
    await settled();

    expect(page.status).toBe(200);
    expect(await page.text()).toBe(PAGE);
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      event: "site_page_failed",
      path: "/how-it-works",
      message: "TypeError: the assets went away",
    });
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report?.method).toBe("POST");
    expect(report?.url).toBe("https://maneman.in/api/client-errors");
    expect(await report?.json()).toMatchObject({
      kind: "error",
      message: "TypeError: the assets went away",
      path: "/how-it-works",
      source: "mm-site Worker",
      stack: expect.stringContaining("the assets went away") as unknown,
    });
  });

  it("names an invite's landing without its code, which is a person's own", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, reports } = failingOnce();
    const { ctx, settled } = context();

    await createSiteWorker().fetch(new Request("https://maneman.in/r/RM4417"), env, ctx);
    await settled();

    const line = String(logged.mock.calls[0]?.[0]);
    const sent = (await reports[0]?.text()) ?? "";
    expect(JSON.parse(line)).toMatchObject({ path: "/r/" });
    expect(JSON.parse(sent)).toMatchObject({ path: "/r/" });
    expect(line).not.toContain("RM4417");
    expect(sent).not.toContain("RM4417");
  });

  it("gives an invite's link the landing, which serves every code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env } = failingOnce();
    const served: string[] = [];
    const assets = env.ASSETS;
    const watched: SiteEnv = {
      ...env,
      ASSETS: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          served.push(new URL(new Request(input, init).url).pathname);
          return assets.fetch(input, init);
        },
      } as unknown as Fetcher,
    };

    const page = await createSiteWorker().fetch(new Request("https://maneman.in/r/RM4417"), watched);

    expect(page.status).toBe(200);
    expect(served.at(-1)).toBe("/r");
  });
});
