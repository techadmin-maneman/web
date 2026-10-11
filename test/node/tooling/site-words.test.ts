// The site's build reads the words published for its environment (scripts/lib/site-words.ts,
// docs/decisions/0127-publishing-the-words.md), and stops rather than build without them.

import { describe, expect, it } from "vitest";
import { fetchSiteWords, type Fetcher } from "../../../scripts/lib/site-words.ts";

/** A fetch that answers `body` with `status`, and records what it was asked. */
function answering(body: unknown, status = 200) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: Fetcher = (url, init) => {
    asked.push({ url, headers: init.headers });
    return Promise.resolve(Response.json(body, { status }));
  };
  return { fetcher, asked };
}

const PUBLISHED = { id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e", words: { "site:home/hero.title": "Hair, at home." } };

describe("the published words a build reads", () => {
  it("are staging's own, read past Access with the service token", async () => {
    const { fetcher, asked } = answering(PUBLISHED);
    const env = { CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret" };
    expect(await fetchSiteWords("staging", env, fetcher)).toEqual({ "site:home/hero.title": "Hair, at home." });
    expect(asked).toEqual([
      {
        url: "https://staging.maneman.in/api/site-words",
        headers: { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret" },
      },
    ]);
  });

  it("are production's own, with no token to send", async () => {
    const { fetcher, asked } = answering({ id: null, words: {} });
    expect(await fetchSiteWords("production", {}, fetcher)).toEqual({});
    expect(asked).toEqual([{ url: "https://maneman.in/api/site-words", headers: {} }]);
  });

  it("are none for a local build, which asks nothing", async () => {
    const { fetcher, asked } = answering(PUBLISHED);
    expect(await fetchSiteWords("local", {}, fetcher)).toEqual({});
    expect(asked).toEqual([]);
  });

  it("keep only words, whatever else comes back", async () => {
    const { fetcher } = answering({ words: { "site:home/hero.title": "Hair.", "site:home/x": 3 } });
    expect(await fetchSiteWords("staging", {}, fetcher)).toEqual({ "site:home/hero.title": "Hair." });
  });

  it("stop the build when they cannot be read, so a deploy never drops them", async () => {
    await expect(fetchSiteWords("staging", {}, answering({}, 503).fetcher)).rejects.toThrow("HTTP 503");
    await expect(fetchSiteWords("staging", {}, answering({ words: "no" }).fetcher)).rejects.toThrow("shape");
  });
});
