// The audit log as the console's Activity page reads it (src/routes/ops/activity.ts): newest first, each person named
// as the console knows them, a client's whole record in one timeline, and a page at a time. Every name, number and ID
// is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { auditStatement, type AuditEntry } from "../../../src/domain/ops/audit.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const CLIENT = "0d1e2f30-0000-4000-8000-000000000001";
const OTHER_CLIENT = "0d1e2f30-0000-4000-8000-000000000002";
const VISIT = "0a1b2c3d-0000-4000-8000-000000000001";
const IMRAN = "t-imran";

function opsAs(email: string): App {
  const access = { verify: () => Promise.resolve({ ok: true as const, identity: { kind: "staff" as const, email } }) };
  return appFor("local", fakeDependencies({ access, now: () => NOW }), {}, "ops");
}

interface Entry {
  id: number;
  at: string;
  actor: { kind: string; id: string; name: string | null };
  action: string;
  subject: { kind: string; id: string } | null;
}

const READER = "owner@maneman.in";

/** A page of the log, less the entry each reading writes of itself, as every ops call does. */
async function read(query = ""): Promise<{ entries: Entry[]; next_before: number | null }> {
  const answer = await request(opsAs(READER), `/api/activity${query}`);
  expect(answer.status).toBe(200);
  const page = await answer.json<{ entries: Entry[]; next_before: number | null }>();
  return { ...page, entries: page.entries.filter((entry) => entry.actor.id !== READER) };
}

/** The log as the test writes it, each entry a minute after the one before, from 09:00 on 21 September in India. */
async function logged(entries: readonly Omit<AuditEntry, "requestId">[]): Promise<void> {
  const start = Date.parse("2026-09-21T03:30:00.000Z");
  await env.DB.batch(
    entries.map((entry, index) =>
      auditStatement(env.DB, { ...entry, requestId: null }, new Date(start + index * 60_000)),
    ),
  );
}

const staff = (id: string) => ({ kind: "staff" as const, id });

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'),
       (?2, ?3, '+919810000002', 'Kabir Suri')`,
  )
    .bind(CLIENT, OTHER_CLIENT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, ?2)",
  )
    .bind(IMRAN, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, 'service', 'scheduled', '2026-09-25T03:30:00.000Z', '2026-09-25T06:30:00.000Z', ?3, ?4)`,
  )
    .bind(VISIT, CLIENT, IMRAN, NOW.toISOString())
    .run();
});

describe("the activity log", () => {
  it("lists who did what, on which record, newest first, naming each person the console knows", async () => {
    await logged([
      { surface: "client", actor: { kind: "client", id: CLIENT }, action: "client.call" },
      { surface: "tech", actor: { kind: "technician", id: IMRAN }, action: "tech.call" },
      {
        surface: "ops",
        actor: staff("care@maneman.in"),
        action: "visit.cancel",
        subject: { kind: "appointment", id: VISIT },
      },
    ]);

    const { entries, next_before } = await read();

    expect(entries.map((entry) => [entry.actor, entry.action, entry.subject])).toEqual([
      [{ kind: "staff", id: "care@maneman.in", name: null }, "visit.cancel", { kind: "appointment", id: VISIT }],
      [{ kind: "technician", id: IMRAN, name: "Imran Qureshi" }, "tech.call", null],
      [{ kind: "client", id: CLIENT, name: "Rohit Malhotra" }, "client.call", null],
    ]);
    expect(next_before).toBeNull();
  });

  it("gives one client's whole record: what they did, and what was done to them and their visits", async () => {
    await logged([
      { surface: "client", actor: { kind: "client", id: CLIENT }, action: "consent.switch" },
      { surface: "client", actor: { kind: "client", id: OTHER_CLIENT }, action: "consent.switch" },
      { surface: "ops", actor: staff("care@maneman.in"), action: "ops.call", subject: { kind: "person", id: CLIENT } },
      {
        surface: "ops",
        actor: staff("care@maneman.in"),
        action: "visit.cancel",
        subject: { kind: "appointment", id: VISIT },
      },
      {
        surface: "ops",
        actor: staff("care@maneman.in"),
        action: "ops.call",
        subject: { kind: "person", id: OTHER_CLIENT },
      },
    ]);

    const { entries } = await read(`?person=${CLIENT}`);

    expect(entries.map((entry) => entry.action)).toEqual(["visit.cancel", "ops.call", "consent.switch"]);
  });

  it("narrows to one person's actions, one kind of action, one visit, and the India days asked for", async () => {
    await logged([
      { surface: "ops", actor: staff("care@maneman.in"), action: "price.set" },
      { surface: "ops", actor: staff("lead@maneman.in"), action: "price.set" },
      {
        surface: "ops",
        actor: staff("lead@maneman.in"),
        action: "visit.cancel",
        subject: { kind: "appointment", id: VISIT },
      },
    ]);

    expect((await read("?actor=lead@maneman.in")).entries).toHaveLength(2);
    expect((await read("?action=price.set")).entries).toHaveLength(2);
    expect((await read(`?visit=${VISIT}`)).entries.map((entry) => entry.action)).toEqual(["visit.cancel"]);
    expect((await read("?from=2026-09-21&to=2026-09-21")).entries).toHaveLength(3);
    expect((await read("?from=2026-09-22")).entries).toHaveLength(0);
  });

  it("names no erased client, only their ID", async () => {
    await logged([{ surface: "client", actor: { kind: "client", id: CLIENT }, action: "deletion.request" }]);
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(CLIENT, NOW.toISOString()).run();

    expect((await read()).entries[0]?.actor).toEqual({ kind: "client", id: CLIENT, name: null });
  });

  it("is itself written to the log, under whoever read it", async () => {
    await request(opsAs(READER), "/api/activity?action=price.set");

    const reading = await env.DB.prepare("SELECT actor, detail FROM audit_log WHERE action = 'ops.call'").first();
    expect(reading).toEqual({
      actor: READER,
      detail: JSON.stringify({ method: "GET", route: "/api/activity", path: "/api/activity" }),
    });
  });

  it("gives fifty at a time, each page going on from the last", async () => {
    await logged(
      Array.from({ length: 55 }, () => ({
        surface: "ops" as const,
        actor: staff("care@maneman.in"),
        action: "price.set" as const,
      })),
    );

    const first = await read("?action=price.set");
    expect(first.entries).toHaveLength(50);
    expect(first.next_before).toBe(first.entries.at(-1)?.id);

    const second = await read(`?action=price.set&before=${String(first.next_before)}`);
    expect(second.entries).toHaveLength(5);
    expect(second.next_before).toBeNull();
  });
});
