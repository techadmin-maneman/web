// The visits the Tasks board raises because nobody is looking after them: one with no technician, due the day before
// it, and told of on its own day; and one still open once its day is over. NOW is Monday 21 September 2026, 12 noon in
// India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { tellOfUnassignedToday } from "../../../src/domain/dispatch/unassigned.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { A, B, IMRAN, ROHIT, TUESDAY, insertJob } from "./dispatch-fixtures.ts";

let ops: App;

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?2)`,
  )
    .bind(IMRAN, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
});

const tasksOf = async (group: string) => {
  const body = await (
    await request(ops, "/api/tasks")
  ).json<{
    groups: { group: string; tasks: { id: string; detail: string | null; due: string }[] }[];
  }>();
  return body.groups.find((each) => each.group === group)?.tasks ?? [];
};

describe("a visit with no technician", () => {
  it("is a task due the day before it, gone once someone is sent", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: null });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN });
    expect(await tasksOf("unassigned_visit")).toEqual([
      expect.objectContaining({ id: A, detail: `service ${TUESDAY["09:00"]}`, due: "2026-09-21T03:30:00.000Z" }),
    ]);
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE id = ?2").bind(IMRAN, A).run();
    expect(await tasksOf("unassigned_visit")).toEqual([]);
  });

  it("is told of on its own day, once, and closed once someone is sent", async () => {
    // Today, 4 pm in India, with nobody to go.
    await insertJob(A, { type: "service", start: "2026-09-21T10:30:00.000Z", technician: null });
    // Tomorrow's is the Tasks board's alone.
    await insertJob(B, { type: "service", start: TUESDAY["09:00"], technician: null });
    const told: string[] = [];
    const resolved: string[] = [];
    const deps = {
      alertOnce: (alert: { key: string }) => {
        told.push(alert.key);
        return Promise.resolve();
      },
      resolveAlert: (key: string) => {
        resolved.push(key);
        return Promise.resolve();
      },
    };
    expect(await tellOfUnassignedToday(env.DB, deps, NOW)).toBe(1);
    expect(told).toEqual([`unassigned_visit:${A}`]);

    await env.DB.prepare(
      `INSERT INTO alerts (id, key, message, count, first_seen_at, last_seen_at)
       VALUES ('alert-1', ?1, 'No technician', 1, ?2, ?2)`,
    )
      .bind(`unassigned_visit:${A}`, NOW.toISOString())
      .run();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE id = ?2").bind(IMRAN, A).run();
    expect(await tellOfUnassignedToday(env.DB, deps, NOW)).toBe(0);
    expect(resolved).toEqual([`unassigned_visit:${A}`]);
  });
});

describe("a visit still open once its day is over", () => {
  it("is a task from the midnight after its day, whether nobody came or it was never closed", async () => {
    // Saturday's, nobody came; Sunday's, begun and never closed; today's is still today's.
    await insertJob(A, { type: "service", start: "2026-09-19T03:30:00.000Z", technician: IMRAN });
    await insertJob(B, {
      type: "service",
      start: "2026-09-20T03:30:00.000Z",
      technician: IMRAN,
      status: "in_progress",
    });
    await insertJob("22222222-2222-4222-8222-2222222222c1", {
      type: "service",
      start: "2026-09-21T03:30:00.000Z",
      technician: IMRAN,
    });
    const open = await tasksOf("visit_left_open");
    expect(open.map((task) => [task.id, task.detail])).toEqual([
      [A, "scheduled 2026-09-19T03:30:00.000Z"],
      [B, "in_progress 2026-09-20T03:30:00.000Z"],
    ]);
  });
});
