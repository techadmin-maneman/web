// A campaign link at the site Worker (site/src/worker.ts; ADR 0288): /s/<slug> and /o/<slug> send the visitor to /book
// with the link's tags and code, and with whatever the ad added to the link, Google's and Meta's click IDs above all;
// a link that is retired, or not ours, sends them to plain /book, the click IDs still with them.

import { describe, expect, it } from "vitest";
import { createSiteWorker } from "../../../site/src/worker.ts";
import { siteEnv } from "./site-worker-fixtures.ts";

const LANDING = "/book?utm_source=meta&utm_medium=paid_social&utm_campaign=national-diwali&offer=DW7K3P";

const open = async (path: string, landing: string | null) => {
  const { env, asked } = siteEnv((request) =>
    new URL(request.url).pathname === "/api/links/o/diwali" && landing !== null
      ? Response.json({ landing })
      : Response.json({ error: { code: "not_found" } }, { status: 404 }),
  );
  const response = await createSiteWorker().fetch(new Request(`https://maneman.in${path}`), env);
  return { response, asked };
};

describe("a campaign link", () => {
  it("lands on /book with its tags and code, keeping the ad's click IDs, its own tags winning", async () => {
    const { response, asked } = await open("/o/diwali?fbclid=IwAR_test&gclid=Cj0_test&utm_source=facebook", LANDING);

    expect(response.status).toBe(302);
    const landed = new URL(response.headers.get("Location") ?? "");
    expect(landed.pathname).toBe("/book");
    expect(Object.fromEntries(landed.searchParams)).toEqual({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "national-diwali",
      offer: "DW7K3P",
      fbclid: "IwAR_test",
      gclid: "Cj0_test",
    });
    expect(asked.map((request) => new URL(request.url).pathname)).toEqual(["/api/links/o/diwali"]);
  });

  it("that is retired lands on plain /book, the click IDs still kept", async () => {
    const { response } = await open("/o/diwali?gbraid=0AAA_test", null);

    expect(response.headers.get("Location")).toBe("https://maneman.in/book?gbraid=0AAA_test");
  });
});
