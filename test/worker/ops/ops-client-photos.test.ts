// One client's record on the ops surface (src/routes/ops/clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { PHOTO_VIEW_MINUTES } from "../../../src/domain/field/photo-views.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, OTHER, UNKNOWN, VISIT, FRONT, TOP, MOBILE, person, record } from "./ops-clients-fixtures.ts";

let ops: App;

const auditRows = () =>
  env.DB.prepare("SELECT action, actor, subject_kind, subject_id, detail FROM audit_log WHERE action != 'ops.call'")
    .all<{ action: string; actor: string; subject_kind: string; subject_id: string; detail: string | null }>()
    .then((rows) => rows.results);

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
});

/** A database whose audit writes for one action fail, to prove nothing audited happens unaudited. */
function auditFailsFor(db: D1Database, action: string): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string): D1PreparedStatement => {
        const statement = target.prepare(sql);
        if (!/INSERT INTO audit_log/i.test(sql)) return statement;
        return new Proxy(statement, {
          get(inner, key, self) {
            if (key !== "bind") return Reflect.get(inner, key, self) as unknown;
            return (...values: unknown[]): D1PreparedStatement =>
              values.includes(action)
                ? ({ run: () => Promise.reject(new Error("D1_ERROR: simulated write failure")) } as D1PreparedStatement)
                : inner.bind(...values);
          },
        });
      };
    },
  });
}

describe("GET /api/clients/{id}/photos", () => {
  it("lists what there is by visit, in the design's angle order, and serves no image or key", async () => {
    await record();
    const body = await (
      await request(ops, `/api/clients/${PERSON}/photos`)
    ).json<{ visits: Record<string, never>[] }>();

    expect(body.visits).toEqual([
      {
        visit_id: VISIT,
        date: "2026-09-10",
        type: "service",
        technician: { name: "Imran Qureshi", initials: "IQ" },
        photos: [
          { id: FRONT, phase: "after", angle: "front", width: 600, height: 800, taken_at: NOW.toISOString() },
          { id: TOP, phase: "after", angle: "top", width: 600, height: 800, taken_at: NOW.toISOString() },
        ],
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("visits/");
    expect(await auditRows()).toEqual([]);
  });
});

/**
 * One opening of a client's photographs is one entry in the log, whose time is
 * the server's. It once wrote an entry for every image, ten for one
 * visit and ten more on every return to the tab, and the console lettered the
 * browser's own clock as the time it was logged.
 */
describe("POST /api/clients/{id}/photos/view", () => {
  const view = (app = ops) =>
    request(app, `/api/clients/${PERSON}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });

  it("writes one entry naming the staff and the client, and answers when it was logged", async () => {
    await record();
    const answer = await view();

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [],
    });
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);
  });

  it("serves every photograph within the view, and writes nothing more for them", async () => {
    await record();
    await view();
    for (const photo of [FRONT, TOP]) {
      const answer = await request(ops, `/api/clients/${PERSON}/photos/${photo}`);
      expect(answer.status, photo).toBe(200);
      expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(await auditRows()).toHaveLength(1);
  });

  it("says who opened them before, the latest first", async () => {
    await record();
    const earlier = (minutes: number) =>
      appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() - minutes * 60_000) }), {}, "ops");
    await view(earlier(24 * 60));
    await view(earlier(90));

    expect(await (await view()).json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [
        { by: "ops@localhost", at: new Date(NOW.getTime() - 90 * 60_000).toISOString() },
        { by: "ops@localhost", at: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString() },
      ],
    });
  });

  it("logs nothing for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });
    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });

  it("opens nothing when the view cannot be logged", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/view`,
      { method: "POST", headers: { Origin: "https://maneman.test" } },
      { DB: auditFailsFor(env.DB, "photo.view") },
    );
    expect(answer.status).toBe(503);
    expect(await auditRows()).toEqual([]);
  });
});

describe("GET /api/clients/{id}/photos/{photo_id}", () => {
  // The console always opens a view first; a photograph asked for outside one still never leaves unlogged.
  it("logs a view itself, before the image, when none by this member of staff is open", async () => {
    await record();
    const answer = await request(ops, `/api/clients/${PERSON}/photos/${FRONT}`);

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("image/jpeg");
    expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);

    // Within the view, the next one adds nothing; once the view has closed, it is logged again.
    await request(ops, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(1);
    const later = appFor(
      "local",
      fakeDependencies({ now: () => new Date(NOW.getTime() + (PHOTO_VIEW_MINUTES + 1) * 60_000) }),
      {},
      "ops",
    );
    await request(later, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(2);
  });

  it("serves no photograph when the view cannot be audited", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/${FRONT}`,
      {},
      { DB: auditFailsFor(env.DB, "photo.view") },
    );

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await auditRows()).toEqual([]);
  });

  it("answers 404, unaudited, for another client's photograph", async () => {
    await record();
    await person(OTHER, "Vikram Sethi", "+919810000002");
    const answer = await request(ops, `/api/clients/${OTHER}/photos/${FRONT}`);

    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });
});
