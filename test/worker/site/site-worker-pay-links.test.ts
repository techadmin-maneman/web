// A payment link's WhatsApp button at the site Worker (site/src/worker.ts; docs/decisions/0300-payment-links-on-whatsapp.md):
// /pay/<token> sends the client on to Razorpay while mm-api says the link is open; otherwise on to a page of ours by an
// address without the token: that it has closed, or that it could not be opened just now. It sends no one anywhere but
// Razorpay and our own pages, whatever mm-api answers.

import { describe, expect, it } from "vitest";
import { createSiteWorker } from "../../../site/src/worker.ts";
import { siteEnv, type Api } from "./site-worker-fixtures.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

const open = async (path: string, api: Api) => {
  const { env, asked, files } = siteEnv(api);
  const visit = new Request(`https://maneman.in${path}`, { headers: { "CF-Connecting-IP": "203.0.113.7" } });
  const response = await createSiteWorker().fetch(visit, env);
  return { response, asked, files };
};

describe("a payment link's button", () => {
  it("sends the client on to Razorpay while the link is open, asking from their address", async () => {
    const { response, asked } = await open(`/pay/${TOKEN}`, () => Response.json({ url: "https://rzp.io/rzp/S3qAbc" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://rzp.io/rzp/S3qAbc");
    expect(asked.map((request) => new URL(request.url).pathname)).toEqual([`/api/pay/${TOKEN}`]);
    expect(asked[0]?.headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
  });

  // Never served in place: the page's address would hold the token, for its tags, history and reports to keep.
  it("sends the client to /pay, without the token, for a link mm-api says is not open", async () => {
    for (const status of [404, 429]) {
      const { response, files } = await open(`/pay/${TOKEN}`, () =>
        Response.json({ error: { code: "not_found" } }, { status }),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://maneman.in/pay");
      expect(files).toEqual([]);
    }
  });

  // The link may still be open: never told it has closed.
  it("sends the client to /pay-again when mm-api could not say", async () => {
    for (const api of [
      () => Response.json({ error: { code: "internal_error" } }, { status: 500 }),
      () => Promise.reject(new Error("unreachable")),
    ] satisfies Api[]) {
      const { response } = await open(`/pay/${TOKEN}`, api);
      expect(response.headers.get("Location")).toBe("https://maneman.in/pay-again");
    }
  });

  it("never sends anyone anywhere but Razorpay", async () => {
    const { response } = await open(`/pay/${TOKEN}`, () => Response.json({ url: "https://evil.example/rzp.io/" }));

    expect(response.headers.get("Location")).toBe("https://maneman.in/pay-again");
  });

  it("asks mm-api nothing for an address that is no token of ours", async () => {
    const { asked } = await open("/pay/short", () => Response.json({ url: "https://rzp.io/rzp/S3qAbc" }));

    expect(asked).toEqual([]);
  });
});
