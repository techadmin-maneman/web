// Where a client is signed in, and ending it (src/routes/client-sessions.ts; docs/decisions/0029-sessions.md).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const ORIGIN = "https://maneman.test";
const HOUR = 60 * 60 * 1000;

let client: App;
let here: string;

/** A session of p1's opened `hoursAgo`, from `device`; its cookie. */
async function signedIn(device: string | null, hoursAgo: number, subjectId = "p1"): Promise<string> {
  const now = new Date(NOW.getTime() - hoursAgo * HOUR);
  return `mm_app=${await openSession(env.DB, { kind: "client", subjectId, deviceLabel: device, now })}`;
}

function send(method: string, path: string, cookie = here) {
  return request(client, path, { method, headers: { Origin: ORIGIN, Cookie: cookie } });
}

const list = async (cookie = here) =>
  (await (await send("GET", "/api/sessions", cookie)).json<{ sessions: Record<string, unknown>[] }>()).sessions;

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES
       ('p1', ?1, '+919810000001', 'Rohit Malhotra', 1), ('p2', ?1, '+919810000002', 'Arjun Mehta', 1)`,
  )
    .bind(NOW.toISOString())
    .run();
  here = await signedIn("Chrome on Android", 0);
});

describe("GET /api/sessions", () => {
  it("lists the client's live sessions, the one used last first, this one marked, and no other client's", async () => {
    await signedIn("Safari on iOS", 30);
    await signedIn(null, 2);
    await signedIn("Firefox on Windows", 1, "p2");

    expect(await list()).toEqual([
      expect.objectContaining({ device: "Chrome on Android", this_device: true, last_used_at: NOW.toISOString() }),
      expect.objectContaining({ device: null, this_device: false }),
      expect.objectContaining({ device: "Safari on iOS", this_device: false }),
    ]);
  });

  it("names each session by a short ID that is not the one its cookie is looked up by", async () => {
    const [session] = await list();
    const stored = await env.DB.prepare("SELECT id FROM sessions").first<string>("id");
    expect(session?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(session?.id).not.toBe(stored);
  });
});

describe("signing a session out", () => {
  it("ends another session by its ID, which then lets nothing in", async () => {
    const phone = await signedIn("Safari on iOS", 30);
    const other = (await list()).find((session) => session.this_device === false);

    expect((await send("DELETE", `/api/sessions/${String(other?.id)}`)).status).toBe(204);

    expect((await send("GET", "/api/me", phone)).status).toBe(401);
    expect(await list()).toHaveLength(1);
  });

  it("knows no other client's session, nor one ended already", async () => {
    await signedIn("Firefox on Windows", 1, "p2");
    const theirs = (await list(await signedIn(null, 0, "p2")))[0];
    expect((await send("DELETE", `/api/sessions/${String(theirs?.id)}`)).status).toBe(404);

    const phone = await signedIn("Safari on iOS", 30);
    const mine = (await list()).find((session) => session.this_device === false);
    await send("DELETE", `/api/sessions/${String(mine?.id)}`);
    expect((await send("DELETE", `/api/sessions/${String(mine?.id)}`)).status).toBe(404);
    expect((await send("GET", "/api/me", phone)).status).toBe(401);
  });

  it("signs this browser out when it is the one named, clearing its cookie", async () => {
    const [mine] = await list();
    const answer = await send("DELETE", `/api/sessions/${String(mine?.id)}`);
    expect(answer.status).toBe(204);
    expect(answer.headers.get("Set-Cookie")).toMatch(/__Host-mm_app=;/);
    expect((await send("GET", "/api/me")).status).toBe(401);
  });

  it("signs out every other browser at once, and keeps this one", async () => {
    const phone = await signedIn("Safari on iOS", 30);
    const laptop = await signedIn("Chrome on Windows", 5);
    const theirs = await signedIn("Firefox on Windows", 1, "p2");

    expect((await send("DELETE", "/api/sessions/others")).status).toBe(204);

    expect((await send("GET", "/api/me", phone)).status).toBe(401);
    expect((await send("GET", "/api/me", laptop)).status).toBe(401);
    expect((await send("GET", "/api/me")).status).toBe(200);
    expect((await send("GET", "/api/me", theirs)).status).toBe(200);
  });

  it("needs a session", async () => {
    for (const [method, path] of [
      ["GET", "/api/sessions"],
      ["DELETE", "/api/sessions/others"],
      ["DELETE", "/api/sessions/0123456789abcdef"],
    ] as const) {
      expect((await send(method, path, "mm_app=made-up")).status).toBe(401);
    }
  });
});
