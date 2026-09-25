// The mm-site Worker in front of /r/:code (site/src/worker.ts, docs/decisions/0027-referral-landing.md): what the
// preview says for each invite, and the page it serves when mm-api cannot answer.

import { describe, expect, it } from "vitest";
import worker, { type SiteEnv } from "../../site/src/worker.ts";

const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="You have a Mane Man invite">
<meta property="og:description" content="Home-fitted hair systems.">
<meta property="og:image" content="https://maneman.in/og.png">
<meta property="og:url" content="https://maneman.in/r">
</head><body><div id="invite" data-invite=""></div><p>The landing</p></body></html>`;

const VALID = { state: "valid", referrer_first_name: "Rohit", card: { state: "personal", version: 3 } };
const UNKNOWN = { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } };

type Api = (request: Request) => Response | Promise<Response>;

function siteEnv(api: Api): { env: SiteEnv; asked: Request[] } {
  const asked: Request[] = [];
  const fetcher = (answer: (request: Request) => Response | Promise<Response>) =>
    ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init)),
    }) as unknown as Fetcher;
  const env = {
    ASSETS: fetcher(() => new Response(PAGE, { headers: { "Content-Type": "text/html" } })),
    API: fetcher((request) => {
      asked.push(request);
      return api(request);
    }),
  };
  return { env, asked };
}

async function open(api: Api, headers: HeadersInit = {}) {
  const { env, asked } = siteEnv(api);
  const response = await worker.fetch(new Request("https://maneman.in/r/RM4K7P", { headers }), env);
  const html = await response.text();
  const meta = (property: string) =>
    new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1] ?? "(missing)";
  const invite = /data-invite="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"') ?? "(missing)";
  return { response, html, meta, invite, asked };
}

describe("the site Worker at /r/:code", () => {
  it("names the referrer and promises the visits for a valid invite", async () => {
    const page = await open(() => Response.json(VALID));
    expect(page.meta("og:title")).toBe("Rohit sent you a Mane Man invite");
    expect(page.meta("og:description")).toContain("3 service visits free");
    expect(page.meta("og:image")).toBe("https://maneman.in/api/og/RM4K7P.jpg?v=3");
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
  });

  // REQ-S8-01: a code the API does not know books without credits, so its preview must not promise them.
  it("promises no visits for an invite that is not valid, and versions the house card", async () => {
    const page = await open(() => Response.json(UNKNOWN));
    expect(page.meta("og:title")).toBe("You have a Mane Man invite");
    expect(page.meta("og:description")).not.toContain("service visits");
    expect(page.meta("og:image")).toMatch(/^https:\/\/maneman\.in\/images\/invite-house\.jpg\?v=\d+$/);
  });

  // FEO-18: a failure is not an unknown code. The page is served as built and the island asks again.
  it.each([
    ["answers 503", () => Response.json({ error: { code: "unavailable" } }, { status: 503 })],
    [
      "throws",
      () => {
        throw new Error("mm-api is down");
      },
    ],
    ["answers a shape it does not know", () => Response.json({ state: "valid" })],
    ["answers something that is not JSON", () => new Response("<html>oops</html>")],
  ])("leaves the invite for the page to fetch when mm-api %s", async (_, api: Api) => {
    const page = await open(api);
    expect(page.response.status).toBe(200);
    expect(page.html).toContain("<p>The landing</p>");
    expect(page.invite).toBe("");
    expect(page.meta("og:description")).not.toContain("service visits");
  });

  // FEO-25: mm-api counts an open only for a person, so it needs to know who asked.
  it("passes the visitor's user agent on to mm-api", async () => {
    const page = await open(() => Response.json(VALID), { "User-Agent": "WhatsApp/2.23.20.0" });
    expect(page.asked[0]?.headers.get("User-Agent")).toBe("WhatsApp/2.23.20.0");
  });
});
