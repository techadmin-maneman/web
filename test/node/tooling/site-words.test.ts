// The site's build reads the words published for its environment (scripts/lib/site-words.ts,
// docs/decisions/0127-publishing-the-words.md), and stops rather than build without them.

import { describe, expect, it } from "vitest";
import { fetchSiteBuild, type Fetcher } from "../../../scripts/lib/site-words.ts";

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
    expect((await fetchSiteBuild("staging", env, fetcher)).words).toEqual({ "site:home/hero.title": "Hair, at home." });
    expect(asked).toEqual([
      {
        url: "https://staging.maneman.in/api/site-words",
        headers: { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret" },
      },
    ]);
  });

  it("are production's own, with no token to send", async () => {
    const { fetcher, asked } = answering({ id: null, words: {} });
    expect((await fetchSiteBuild("production", {}, fetcher)).words).toEqual({});
    expect(asked).toEqual([{ url: "https://maneman.in/api/site-words", headers: {} }]);
  });

  it("are none for a local build, which asks nothing", async () => {
    const { fetcher, asked } = answering(PUBLISHED);
    expect((await fetchSiteBuild("local", {}, fetcher)).words).toEqual({});
    expect(asked).toEqual([]);
  });

  it("keep only words, whatever else comes back", async () => {
    const { fetcher } = answering({ words: { "site:home/hero.title": "Hair.", "site:home/x": 3 } });
    expect((await fetchSiteBuild("staging", {}, fetcher)).words).toEqual({ "site:home/hero.title": "Hair." });
  });

  it("stop the build when they cannot be read, so a deploy never drops them", async () => {
    await expect(fetchSiteBuild("staging", {}, answering({}, 503).fetcher)).rejects.toThrow("HTTP 503");
    await expect(fetchSiteBuild("staging", {}, answering({ words: "no" }).fetcher)).rejects.toThrow("shape");
  });
});

describe("the visit lengths a build reads", () => {
  const lengths = { consultation: 45, first_fit: 180, service: 120, replacement: 135 };

  // A length ops changed in the console stayed the code's on the site until a release changed the code.
  it("are the console's, said as the site says a length", async () => {
    const { fetcher } = answering({ id: null, words: {}, lengths });
    expect((await fetchSiteBuild("production", {}, fetcher)).words).toEqual({
      "site:service/visitLength.consultation": "45 minutes",
      "site:service/visitLength.firstFit": "3 hours",
      "site:service/visitLength.service": "2 hours",
    });
  });

  it("give way to words published for the same line, and to a kind that offers nothing", async () => {
    const words = { "site:service/visitLength.service": "about two hours" };
    const { fetcher } = answering({ id: PUBLISHED.id, words, lengths: { ...lengths, consultation: null } });
    expect((await fetchSiteBuild("production", {}, fetcher)).words).toEqual({
      "site:service/visitLength.firstFit": "3 hours",
      "site:service/visitLength.service": "about two hours",
    });
  });
});

describe("Customer Care's times a build reads", () => {
  // The site gives them as its opening hours; a change in the console reaches it at the next deploy.
  it("are the console's, in minutes past midnight", async () => {
    const { fetcher } = answering({ id: null, words: {}, care_times: { opens: 570, closes: 1140 } });
    expect((await fetchSiteBuild("staging", {}, fetcher)).careTimes).toEqual({ opens: 570, closes: 1140 });
  });

  it("are none where the API gives none it can read, so the site keeps its own", async () => {
    for (const care_times of [undefined, { opens: 1140, closes: 570 }, { opens: "09:30", closes: 1140 }]) {
      const { fetcher } = answering({ id: null, words: {}, care_times });
      expect((await fetchSiteBuild("staging", {}, fetcher)).careTimes).toBeNull();
    }
    expect((await fetchSiteBuild("local", {}, answering({}).fetcher)).careTimes).toBeNull();
  });
});
