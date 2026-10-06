// A client's rights over their data (docs/decisions/0049-dpdp.md): erasure reaching the apps' data and Books, the
// data export, grievances, and the deletion window's alert. NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { tellOfNewGrievances } from "../../../src/domain/ops/grievances.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, MOBILE } from "./dpdp-fixtures.ts";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(PERSON, NOW.toISOString(), MOBILE)
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("grievances", () => {
  /** The signed-in client's concern, as their app's Send raises it. */
  function raiseAs(client: ReturnType<typeof appFor>, text: string) {
    return request(client, "/api/grievances", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text }),
    });
  }

  /** The concerns the signed-in client's profile lists. */
  async function shownTo(client: ReturnType<typeof appFor>): Promise<unknown> {
    const profile = await request(client, "/api/profile", { headers: { Cookie: cookie } });
    return (await profile.json<{ grievances: unknown }>()).grievances;
  }

  it("are raised by the client, alert nobody at once, and are answered by ops", async () => {
    const deps = fakeDependencies();
    const raised = await raiseAs(appFor("local", deps, {}, "client"), "My photographs were shown to someone else.");
    expect(raised.status).toBe(201);
    const { id } = await raised.json<{ id: string }>();
    // The team chat hears of it in the hour's one message, not one message a concern.
    expect(deps.alerts).toEqual([]);

    const ops = appFor("local", fakeDependencies(), {}, "ops");
    const open = await (await request(ops, "/api/grievances")).json();
    expect(open).toEqual({
      grievances: [
        {
          id,
          person_id: PERSON,
          name: "Rohit Malhotra",
          mobile: MOBILE,
          text: "My photographs were shown to someone else.",
          raised_at: NOW.toISOString(),
          // The thirty days the app promises (src/policy/tasks.ts).
          due: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
        },
      ],
    });
    const resolve = (response: string) =>
      request(ops, `/api/grievances/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ response }),
      });
    expect(await (await resolve("Called and explained; no photograph was shared.")).json()).toEqual({
      state: "resolved",
    });
    expect((await resolve("again")).status).toBe(404);
  });

  // Once the app reloaded, a client saw nothing of the concern they raised, nor ops' answer.
  it("are listed on the client's profile, open and then with ops' answer", async () => {
    const deps = fakeDependencies();
    const client = appFor("local", deps, {}, "client");
    const { id } = await (await raiseAs(client, "Who sees my photographs?")).json<{ id: string }>();
    expect(await shownTo(client)).toEqual([
      {
        id,
        text: "Who sees my photographs?",
        state: "open",
        raised_at: NOW.toISOString(),
        response: null,
        answered_at: null,
      },
    ]);

    await request(appFor("local", deps, {}, "ops"), `/api/grievances/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ response: "Only your technician and our care team." }),
    });
    expect(await shownTo(client)).toEqual([
      {
        id,
        text: "Who sees my photographs?",
        state: "resolved",
        raised_at: NOW.toISOString(),
        response: "Only your technician and our care team.",
        answered_at: NOW.toISOString(),
      },
    ]);
  });

  it("list the newest five: every open one, and those answered in the last 30 days", async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    const raised = (id: string, createdDaysAgo: number, resolvedDaysAgo: number | null = null) =>
      env.DB.prepare(
        "INSERT INTO grievances (id, person_id, text, state, resolved_at, created_at) VALUES (?1, ?2, ?1, ?3, ?4, ?5)",
      ).bind(
        id,
        PERSON,
        resolvedDaysAgo === null ? "open" : "resolved",
        resolvedDaysAgo === null ? null : daysAgo(resolvedDaysAgo),
        daysAgo(createdDaysAgo),
      );
    const texts = async () => {
      const shown = (await shownTo(appFor("local", fakeDependencies(), {}, "client"))) as { text: string }[];
      return shown.map((grievance) => grievance.text);
    };

    await env.DB.batch([
      raised("open-long-ago", 90),
      raised("answered-long-ago", 45, 40),
      raised("answered-lately", 12, 10),
      raised("open-1", 1),
      raised("open-2", 2),
    ]);
    expect(await texts()).toEqual(["open-1", "open-2", "answered-lately", "open-long-ago"]);

    await env.DB.batch([raised("open-3", 3), raised("open-4", 4), raised("open-5", 5)]);
    expect(await texts()).toEqual(["open-1", "open-2", "open-3", "open-4", "open-5"]);
  });

  // One client could raise concerns without end, each a message in the team chat.
  it("take five new ones a day from a client, where the same words still open are not a new one", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    for (const n of [1, 2, 3, 4, 5]) {
      expect((await raiseAs(client, `Concern ${String(n)}`)).status).toBe(201);
    }
    const sixth = await raiseAs(client, "Concern 6");
    expect(sixth.status).toBe(429);
    expect((await sixth.json<{ error: { code: string } }>()).error.code).toBe("rate_limited");
    // Sent again, an open concern is the one already raised, and costs nothing.
    expect((await raiseAs(client, "Concern 1")).status).toBe(201);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 5 });

    // India's next day is a new allowance.
    const tomorrow = fakeDependencies({ now: () => new Date(NOW.getTime() + 86_400_000) });
    expect((await raiseAs(appFor("local", tomorrow, {}, "client"), "Concern 6")).status).toBe(201);
  });

  it("are told to the team chat in one message an hour, without the client's words", async () => {
    // NOW is 06:30 UTC, so its run tells of the hour from 05:00 to 06:00.
    const at = (time: string) => `2026-09-21T${time}:00.000Z`;
    const rows = [
      { id: "in-the-hour", state: "open", createdAt: at("05:00") },
      { id: "also-in-the-hour", state: "open", createdAt: at("05:59") },
      { id: "answered-already", state: "resolved", createdAt: at("05:30") },
      { id: "told-an-hour-ago", state: "open", createdAt: at("04:59") },
      { id: "told-in-an-hour", state: "open", createdAt: at("06:10") },
    ];
    await env.DB.batch(
      rows.map((row) =>
        env.DB.prepare(
          "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES (?1, ?2, 'Private words', ?3, ?4)",
        ).bind(row.id, PERSON, row.state, row.createdAt),
      ),
    );
    const told: string[] = [];
    const tell = (message: string) => {
      told.push(message);
      return Promise.resolve();
    };
    const queue = "https://ops.test/grievances";

    expect(await tellOfNewGrievances(env.DB, tell, queue, NOW)).toBe(2);
    expect(told).toEqual([`2 grievances were raised in the last hour. Answer them in Grievances: ${queue}`]);

    // An hour on, the one raised since; and an hour after that, with nothing new, nobody is told.
    expect(await tellOfNewGrievances(env.DB, tell, queue, new Date(NOW.getTime() + 3_600_000))).toBe(1);
    expect(await tellOfNewGrievances(env.DB, tell, queue, new Date(NOW.getTime() + 7_200_000))).toBe(0);
    expect(told).toEqual([
      `2 grievances were raised in the last hour. Answer them in Grievances: ${queue}`,
      `A client raised a grievance in the last hour. Answer it in Grievances: ${queue}`,
    ]);
  });

  it("are one grievance when the same words arrive twice at the same moment", async () => {
    const deps = fakeDependencies();
    const client = appFor("local", deps, {}, "client");
    const raise = () =>
      request(client, "/api/grievances", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ text: "Please explain who sees my photographs." }),
      });

    // Both taps are in flight together, as they are when a client taps Send twice on the profile.
    const both = await Promise.all([raise(), raise()]);
    expect(both.map((answer) => answer.status)).toEqual([201, 201]);
    const ids = await Promise.all(both.map(async (answer) => (await answer.json<{ id: string }>()).id));
    // One row, so one answer-time clock; and the tap that wrote nothing is answered with the
    // grievance the other raised, so both taps name the same concern (ADR 0058).
    expect(ids[0]).toBe(ids[1]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 1 });

    // The same words again, once ops have answered, are a second concern and a second clock.
    const ops = appFor("local", fakeDependencies(), {}, "ops");
    await request(ops, `/api/grievances/${ids[0]}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ response: "Explained on WhatsApp." }),
    });
    expect((await (await raise()).json<{ id: string }>()).id).not.toBe(ids[0]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 2 });
  });
});
