// The words the Words page published for an environment, which the site's build lays over its copy
// (docs/decisions/0127-publishing-the-words.md): read from that environment's own site, past Access on staging. A
// build that cannot read them stops, so a deploy never puts the code's wording back over what was published. With
// them come the lengths ops gave each kind's service, which become the site's length lines where no words were
// published for one, so its prose says what a visit is booked for.

import { lengthWords } from "../../packages/web-kit/visit-length.ts";

/** Where each environment's site answers, mm-api behind it. A local build lays nothing over the copy. */
export const SITE_ORIGINS: Readonly<Record<string, string>> = {
  staging: "https://staging.maneman.in",
  production: "https://maneman.in",
};

export type Fetcher = (url: string, init: { readonly headers: Record<string, string> }) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The headers that take a request past Access, where its service token is given. */
function accessHeaders(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID ?? "";
  const secret = env.CF_ACCESS_CLIENT_SECRET ?? "";
  return id === "" || secret === "" ? {} : { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

/** The published words for an environment: each changed line's key and words; none for a local build. */
export async function fetchSiteWords(
  environment: string,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: Fetcher,
): Promise<Record<string, string>> {
  const origin = SITE_ORIGINS[environment];
  if (origin === undefined) return {};
  const url = `${origin}/api/site-words`;
  const answer = await fetcher(url, { headers: accessHeaders(env) });
  if (!answer.ok) throw new Error(`the published words could not be read: HTTP ${String(answer.status)} from ${url}`);
  const body: unknown = await answer.json();
  if (!isRecord(body) || !isRecord(body.words)) {
    throw new Error(`the published words from ${url} came back in a shape the build does not know`);
  }
  const words = Object.fromEntries(
    Object.entries(body.words).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { ...lengthLines(body.lengths), ...words };
}

/** The site's length line for each kind of visit, by its key in src/config/words.json. */
const LENGTH_LINES = {
  consultation: "site:service/visitLength.consultation",
  service: "site:service/visitLength.service",
  first_fit: "site:service/visitLength.firstFit",
} as const;

/** A line for each kind the API gave a length for, in the site's words. */
function lengthLines(lengths: unknown): Record<string, string> {
  if (!isRecord(lengths)) return {};
  return Object.fromEntries(
    Object.entries(LENGTH_LINES).flatMap(([kind, key]) => {
      const minutes = lengths[kind];
      return typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0
        ? [[key, lengthWords(minutes)]]
        : [];
    }),
  );
}
