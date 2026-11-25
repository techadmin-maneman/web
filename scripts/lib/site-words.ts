// The words the Words page published for an environment, which the site's build lays over its copy
// (docs/decisions/0127-publishing-the-words.md): read from that environment's own site, past Access on staging. A
// build that cannot read them stops, so a deploy never puts the code's wording back over what was published. With
// them come the lengths ops gave each kind's service, which become the site's length lines where no words were
// published for one, so its prose says what a visit is booked for; Customer Care's times, which the site gives as its
// opening hours; and the cities ops serve, which have the site's city pages
// (docs/decisions/0325-search-pages-and-opening-hours.md).

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

/** Customer Care's times, minutes past midnight in India. */
export interface CareTimes {
  readonly opens: number;
  readonly closes: number;
}

/** What a site's build reads from its environment. */
export interface SiteBuild {
  /** Each changed line's key and words. */
  readonly words: Record<string, string>;
  /** Care's times as ops set them; null where the API gives none it can read. */
  readonly careTimes: CareTimes | null;
  /** The cities ops serve, in the console's order; null for a build that reads none. */
  readonly cities: readonly string[] | null;
}

/** The published words, Care's times and the cities served for an environment; none for a local build. */
export async function fetchSiteBuild(
  environment: string,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: Fetcher,
): Promise<SiteBuild> {
  const origin = SITE_ORIGINS[environment];
  if (origin === undefined) return { words: {}, careTimes: null, cities: null };
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
  return {
    words: { ...lengthLines(body.lengths), ...words },
    careTimes: careTimesOf(body.care_times),
    cities: await servedCities(origin, env, fetcher),
  };
}

/** The cities ops serve, as GET /api/served-cities answers them. A build that cannot read them stops, as for the words. */
async function servedCities(
  origin: string,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: Fetcher,
): Promise<string[]> {
  const url = `${origin}/api/served-cities`;
  const answer = await fetcher(url, { headers: accessHeaders(env) });
  if (!answer.ok) throw new Error(`the cities served could not be read: HTTP ${String(answer.status)} from ${url}`);
  const body: unknown = await answer.json();
  const cities = isRecord(body) ? body.cities : undefined;
  if (!Array.isArray(cities) || !cities.every((city) => typeof city === "string" && city !== "")) {
    throw new Error(`the cities served from ${url} came back in a shape the build does not know`);
  }
  return cities as string[];
}

const isMinuteOfDay = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;

/** Care's times, where the API gave two minutes of the day in order; else none, and the site keeps its own. */
function careTimesOf(value: unknown): CareTimes | null {
  if (!isRecord(value) || !isMinuteOfDay(value.opens) || !isMinuteOfDay(value.closes)) return null;
  return value.opens < value.closes ? { opens: value.opens, closes: value.closes } : null;
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
