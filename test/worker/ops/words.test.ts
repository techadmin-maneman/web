// The Words page's API (src/routes/ops/words.ts, src/domain/words/words.ts; docs/decisions/0126-the-words-page.md):
// every line of the site and every message to a client, a line given new words once they pass the checks, its
// history, and a line put back to the code's wording.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TEMPLATES } from "../../../src/config/message-templates.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";

let ops: App;

interface Word {
  key: string;
  surface: string;
  text: string;
  now: string;
  changed: { by: string; at: string } | null;
}

const REMINDER = "message:visit_reminder_v1";

const set = (key: string, text: string | null) =>
  request(ops, "/api/words", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ key, text }),
  });

const words = async () => (await (await request(ops, "/api/words")).json<{ words: Word[] }>()).words;

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the Words page", () => {
  it("lists the site's copy and every message to a client, each at the code's wording until changed", async () => {
    const listed = await words();
    expect(listed.length).toBeGreaterThan(600);
    expect(listed.find((word) => word.key === REMINDER)).toEqual(
      expect.objectContaining({
        surface: "message",
        text: TEMPLATES.visit_reminder_v1,
        now: TEMPLATES.visit_reminder_v1,
        changed: null,
      }),
    );
    expect(listed.some((word) => word.key === "message:login_code_v1")).toBe(false);
  });

  it("gives a line new words that keep its details, and keeps every wording it has had", async () => {
    const reworded = "Hi {{1}}, see you tomorrow.\n{{2}}: {{3}}, {{4}}, with {{5}}. To move it, open the Mane Man app.";
    const answer = await set(REMINDER, reworded);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ word: { now: reworded, changed: { by: expect.any(String) } } });
    expect((await words()).find((word) => word.key === REMINDER)?.now).toBe(reworded);

    const back = await set(REMINDER, null);
    expect(await back.json()).toMatchObject({ word: { now: TEMPLATES.visit_reminder_v1, changed: null } });
    const history = await request(ops, `/api/words/history?key=${encodeURIComponent(REMINDER)}`);
    expect((await history.json<{ versions: { text: string | null }[] }>()).versions.map((each) => each.text)).toEqual([
      null,
      reworded,
    ]);
    const { results } = await env.DB.prepare(
      "SELECT action, subject_id FROM audit_log WHERE action = 'word.set'",
    ).all();
    expect(results).toEqual([
      { action: "word.set", subject_id: REMINDER },
      { action: "word.set", subject_id: REMINDER },
    ]);
  });

  it("refuses words that drop a detail, name the visit on the lock screen, or type a price", async () => {
    const dropped = await set(REMINDER, "Hi {{1}}, see you tomorrow.\nYour visit is tomorrow. Open the Mane Man app.");
    expect(await dropped.json()).toMatchObject({ error: { code: "invalid_request", fields: ["text.holes"] } });
    const named = await set(
      REMINDER,
      "Hi {{1}}, your hair system visit is tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}. Open the Mane Man app.",
    );
    expect(await named.json()).toMatchObject({ error: { fields: ["text.first_line"] } });
    const site = (await words()).find((word) => word.surface === "site" && !/[{]/.test(word.text));
    const priced = await set(site?.key ?? "", "From Rs. 30,000, fitted at home.");
    expect(await priced.json()).toMatchObject({ error: { fields: ["text.price"] } });
  });

  it("knows no line it does not list", async () => {
    expect((await set("site:legal/privacy.body", "Anything")).status).toBe(404);
    expect((await request(ops, "/api/words/history?key=message%3Alogin_code_v1")).status).toBe(404);
  });
});
