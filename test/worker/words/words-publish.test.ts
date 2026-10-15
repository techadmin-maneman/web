// Publishing the site's words (src/domain/words/publish.ts, src/routes/ops/words.ts, src/routes/public/site-words.ts;
// docs/decisions/0127-publishing-the-words.md): a publish keeps the site's changed lines as they stand, the site's
// build reads them, and each line says whether the site has its wording.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";

let ops: App;
let site: App;

const HERO = "site:home/hero.sequence.2";
const REMINDER = "message:visit_reminder_v1";

interface Listed {
  words: { key: string; now: string; on_site: boolean | null }[];
  published: { lines: number } | null;
}

const post = (path: string, body?: unknown) =>
  request(ops, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const listed = async () => (await request(ops, "/api/words")).json<Listed>();
const onSite = async (key: string) => (await listed()).words.find((word) => word.key === key)?.on_site;
const siteWords = async () =>
  (await request(site, "/api/site-words")).json<{
    id: string | null;
    words: object;
    lengths: Record<string, number | null>;
  }>();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  site = appFor("local", fakeDependencies(), {}, "public");
});

describe("publishing the site's words", () => {
  it("gives the site's build nothing before any publish", async () => {
    expect(await siteWords()).toMatchObject({ id: null, published_at: null, words: {} });
    expect((await listed()).published).toBeNull();
    expect(await onSite(HERO)).toBe(true);
  });

  it("keeps the site's changed lines as they stand, and nothing of the messages", async () => {
    expect((await post("/api/words", { key: HERO, text: "Fitted where you live." })).status).toBe(200);
    const reminder = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}.";
    expect((await post("/api/words", { key: REMINDER, text: reminder })).status).toBe(200);
    expect(await onSite(HERO)).toBe(false);
    expect(await onSite(REMINDER)).toBeNull();

    const published = await post("/api/words/publish");
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ published: { lines: 1 } });
    expect((await siteWords()).words).toEqual({ [HERO]: "Fitted where you live." });
    expect(await onSite(HERO)).toBe(true);

    const { results } = await env.DB.prepare(
      "SELECT action, detail FROM audit_log WHERE action = 'word.publish'",
    ).all();
    expect(results).toEqual([{ action: "word.publish", detail: JSON.stringify({ lines: 1 }) }]);
  });

  it("marks a line put back to the code's wording as off the site until the next publish", async () => {
    await post("/api/words", { key: HERO, text: "Fitted where you live." });
    await post("/api/words/publish");
    await post("/api/words", { key: HERO, text: null });
    expect(await onSite(HERO)).toBe(false);
    await post("/api/words/publish");
    expect((await siteWords()).words).toEqual({});
    expect(await onSite(HERO)).toBe(true);
  });

  // A length changed in the console stayed the code's on the site, whose build read lengths from the code alone.
  it("tells the site's build how long each kind of visit is booked for, as ops last set it", async () => {
    const before = (await siteWords()).lengths;
    expect([typeof before.consultation, typeof before.service]).toEqual(["number", "number"]);
    const longer = (before.service ?? 0) + 30;
    expect((await post("/api/services/service/standard/length", { minutes: longer })).status).toBe(200);
    expect((await siteWords()).lengths.service).toBe(longer);
  });
});
