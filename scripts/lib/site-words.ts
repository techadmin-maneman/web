// The words the Words page published for an environment, which the site's build lays over its copy
// (docs/decisions/0127-publishing-the-words.md): read from that environment's own site, past Access on staging. A
// build that cannot read them stops, so a deploy never puts the code's wording back over what was published.

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
  return Object.fromEntries(
    Object.entries(body.words).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
