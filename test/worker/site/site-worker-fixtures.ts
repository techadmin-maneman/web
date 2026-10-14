// What the site Worker's tests share (site-worker*.test.ts): a page, the invite and the referral reward the API answers
// with, the Worker's environment, and what it logged.

import { HOUSE_CARD } from "../../../src/config/house-card.ts";
import { type SiteEnv } from "../../../site/src/worker.ts";

/** The landing's head as the build writes it (site/src/layouts/Site.astro): the house card is its image. */
export const PAGE = `<!doctype html><html><head>
<title>You have a Mane Man invite</title>
<meta name="description" content="Home-fitted hair systems.">
<meta property="og:title" content="You have a Mane Man invite">
<meta property="og:description" content="Home-fitted hair systems.">
<meta property="og:url" content="https://maneman.in/r">
<meta property="og:image" content="https://maneman.in${HOUSE_CARD}">
<meta property="og:image:secure_url" content="https://maneman.in${HOUSE_CARD}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
</head><body><div id="invite" data-invite=""></div><p>The landing</p></body></html>`;

export const VALID = {
  state: "valid",
  referrer_first_name: "Rohit",
  partner: null,
  friend_visits: null,
  discount: null,
  card: { state: "personal", version: 3 },
};

export type Api = (request: Request) => Response | Promise<Response>;

export const isRewardRequest = (request: Request) => new URL(request.url).pathname === "/api/referral-reward";

/** What a referral earns as the console begins, each side 3 visits for a year. */
export const REWARD = { referrer_visits: 3, friend_visits: 3, valid_days: 365 };

/** mm-api answering what a referral earns with `reward`, and anything else with `other`. */
export function withReward(other: Api = () => Response.json(VALID), reward: object = REWARD): Api {
  return (request) => (isRewardRequest(request) ? Response.json(reward) : other(request));
}

export function siteEnv(api: Api, page = PAGE): { env: SiteEnv; asked: Request[]; files: Request[] } {
  const asked: Request[] = [];
  const files: Request[] = [];
  const fetcher = (answer: (request: Request) => Response | Promise<Response>) =>
    ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init)),
    }) as unknown as Fetcher;
  const env = {
    ASSETS: fetcher((request) => {
      files.push(request);
      return new Response(page, { headers: { "Content-Type": "text/html", ETag: '"built-file"' } });
    }),
    API: fetcher((request) => {
      asked.push(request);
      return api(request);
    }),
  };
  return { env, asked, files };
}

/** The lines the Worker wrote to its log, each parsed. */
export function logged(warn: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}
