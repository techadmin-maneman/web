// A hair system marked failed by Care, or its failure taken back, and the closes that ask whether it was at fault
// (src/domain/inventory/piece-failures.ts; docs/decisions/0272-why-a-hair-system-failed.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { remakesOwed } from "../../../src/domain/booking/remakes.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { asClient, client, fittedInAugust, signedIn } from "../clients.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const ROHIT = "5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
const FIT = "fit-1";
const OTHER = "6e4d3c2b-1a0f-4e9d-8c7b-7a6f5e4d3c2b";
const WORN = "MM-STD-4417-B";

const ops = () => appFor("local", fakeDependencies(), {}, "ops");
const call = (method: "POST" | "DELETE", path: string, body?: unknown) =>
  request(ops(), path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const failure = `/api/clients/${ROHIT}/pieces/${WORN}/failure`;

const piece = (code: string) =>
  env.DB.prepare(
    `SELECT failed_at, failure_reason, failure_code, replaced_at IS NOT NULL AS replaced FROM pieces
     WHERE piece_code = ?1`,
  )
    .bind(code)
    .first();

/** A piece fitted to Rohit, by their first fit unless another visit is named. */
const fitted = (code: string, on: string, visit: string | null = FIT) =>
  env.DB.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, appointment_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?1, 'Lace', ?3, '2027-02-01', ?4, ?5)`,
  )
    .bind(code, ROHIT, on, visit, NOW.toISOString())
    .run();

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, "+919810000001");
  await fittedInAugust(ROHIT, FIT);
  await fitted(WORN, "2026-08-01");
});

describe("Mark failed", () => {
  it("keeps the reason's words and code on the day given, so the client is owed a replacement, and is logged", async () => {
    await env.DB.prepare(
      `INSERT INTO piece_returns (id, piece_code, appointment_id, technician_id, reason, returned_at)
       VALUES ('ret-1', ?1, ?2, 't-fit', NULL, ?3)`,
    )
      .bind(WORN, FIT, NOW.toISOString())
      .run();
    const answer = await call("POST", failure, { failure_reason: "shedding", failed_on: "2026-09-20" });
    expect(answer.status).toBe(200);
    const body = await answer.json<{ pieces: { piece_code: string; failure_reason: string | null }[] }>();
    expect(body.pieces).toEqual([expect.objectContaining({ piece_code: WORN, failure_reason: "Shedding" })]);
    // Noon in India on the day given.
    expect(await piece(WORN)).toEqual({
      failed_at: "2026-09-20T06:30:00.000Z",
      failure_reason: "Shedding",
      failure_code: "shedding",
      replaced: 0,
    });
    expect(await env.DB.prepare("SELECT reason FROM piece_returns").first()).toEqual({ reason: "Shedding" });
    expect((await remakesOwed(env.DB, ROHIT)).map((owed) => owed.why)).toEqual(["failed"]);
    const logged = await env.DB.prepare(
      "SELECT action, subject_id, detail FROM audit_log WHERE action LIKE 'piece.%'",
    ).first<{ action: string; subject_id: string; detail: string }>();
    expect(logged).toEqual({
      action: "piece.failed",
      subject_id: ROHIT,
      detail: JSON.stringify({ piece_code: WORN, reason: "shedding", failed_on: "2026-09-20" }),
    });
  });

  it("refuses a reason not on the list, a day after today or before the fit, and a piece already failed", async () => {
    const refused = async (body: object) => {
      const answer = await call("POST", failure, body);
      return { status: answer.status, error: (await answer.json<{ error: { fields?: string[] } }>()).error };
    };
    expect(await refused({ failure_reason: "lost_it", failed_on: "2026-09-20" })).toMatchObject({
      status: 400,
      error: { fields: ["failure_reason"] },
    });
    expect(await refused({ failure_reason: "shedding", failed_on: "2026-09-22" })).toMatchObject({
      status: 400,
      error: { fields: ["failed_on"] },
    });
    expect(await refused({ failure_reason: "shedding", failed_on: "2026-07-31" })).toMatchObject({
      status: 400,
      error: { fields: ["failed_on"] },
    });
    expect((await call("POST", failure, { failure_reason: "shedding", failed_on: "2026-09-21" })).status).toBe(200);
    expect((await refused({ failure_reason: "base_torn", failed_on: "2026-09-21" })).status).toBe(409);
    expect(await piece(WORN)).toMatchObject({ failure_reason: "Shedding" });
  });

  it("finds no piece of another client's by its code", async () => {
    await client(OTHER, "+919810000002", "Kabir Sethi");
    expect(
      (
        await call("POST", `/api/clients/${OTHER}/pieces/${WORN}/failure`, {
          failure_reason: "other",
          failed_on: "2026-09-20",
        })
      ).status,
    ).toBe(404);
  });
});

describe("Undo", () => {
  it("takes the failure back with its hand-back's reason, and replaces a piece another was fitted over", async () => {
    await call("POST", failure, { failure_reason: "base_torn", failed_on: "2026-09-10" });
    await env.DB.prepare(
      `INSERT INTO piece_returns (id, piece_code, appointment_id, technician_id, reason, returned_at)
       VALUES ('ret-1', ?1, ?2, 't-fit', 'Base torn', ?3)`,
    )
      .bind(WORN, FIT, NOW.toISOString())
      .run();
    await fitted("MM-STD-5520-A", "2026-09-12", null);

    expect((await call("DELETE", failure)).status).toBe(204);
    expect(await piece(WORN)).toEqual({ failed_at: null, failure_reason: null, failure_code: null, replaced: 1 });
    expect(await env.DB.prepare("SELECT reason FROM piece_returns").first()).toEqual({ reason: null });
    expect((await call("DELETE", failure)).status).toBe(409);
  });

  it("leaves a piece nothing was fitted over in wear", async () => {
    await call("POST", failure, { failure_reason: "base_torn", failed_on: "2026-09-10" });
    expect((await call("DELETE", failure)).status).toBe(204);
    expect(await piece(WORN)).toMatchObject({ failed_at: null, replaced: 0 });
    expect(await remakesOwed(env.DB, ROHIT)).toEqual([]);
  });
});

describe("Was the hair system at fault?", () => {
  it("marks failed today the piece a guarantee claim's fit put on, where Care say so", async () => {
    const cookie = await signedIn(ROHIT);
    const fitStart = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    await env.DB.prepare("UPDATE appointments SET window_start = ?2, window_end = ?2 WHERE id = ?1")
      .bind(FIT, fitStart)
      .run();
    await env.DB.prepare(
      `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
       VALUES ('vo-1', ?1, ?2, ?2, 180, 'done', ?2)`,
    )
      .bind(FIT, fitStart)
      .run();
    await asClient(cookie, "/api/me/problems", { method: "POST", body: { about: "fit_guarantee", text: "Lifting." } });
    const [claim] = (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter(
      (task) => task.group === "fit_guarantee_claim",
    );
    expect(claim).toBeDefined();

    const onAnother = await call("POST", `/api/tasks/partial_visit/${claim?.id ?? ""}/close`, {
      reason: "Refit booked.",
      failure_reason: "edges_lifting",
    });
    expect(onAnother.status).toBe(400);
    const closed = await call("POST", `/api/tasks/fit_guarantee_claim/${claim?.id ?? ""}/close`, {
      reason: "Refit booked.",
      failure_reason: "edges_lifting",
    });
    expect(closed.status).toBe(204);
    expect(await piece(WORN)).toMatchObject({ failure_reason: "Edges lifting", failure_code: "edges_lifting" });
  });

  it("is asked of a chat whose open report is about the hair system worn, and marks it failed today", async () => {
    const cookie = await signedIn(ROHIT);
    await asClient(cookie, "/api/me/problems", {
      method: "POST",
      body: { about: "shedding", text: "Hair everywhere." },
    });
    const chat = await env.DB.prepare("SELECT id FROM conversations WHERE person_id = ?1")
      .bind(ROHIT)
      .first<string>("id");
    const thread = await request(ops(), `/api/conversations/${chat ?? ""}`);
    expect(await thread.json()).toMatchObject({ piece_report: "shedding" });

    const answer = await call("POST", `/api/conversations/${chat ?? ""}/close`, {
      reason: "fit_problem",
      failure_reason: "shedding",
    });
    expect(answer.status).toBe(200);
    expect(await piece(WORN)).toMatchObject({ failed_at: NOW.toISOString().slice(0, 10) + "T06:30:00.000Z" });
  });

  it("is not asked of a chat whose client wears no hair system, and refused there", async () => {
    await env.DB.prepare("UPDATE pieces SET replaced_at = ?1").bind(NOW.toISOString()).run();
    const cookie = await signedIn(ROHIT);
    await asClient(cookie, "/api/me/problems", { method: "POST", body: { about: "colour", text: "Gone orange." } });
    const chat = await env.DB.prepare("SELECT id FROM conversations WHERE person_id = ?1")
      .bind(ROHIT)
      .first<string>("id");
    expect(await (await request(ops(), `/api/conversations/${chat ?? ""}`)).json()).toMatchObject({
      piece_report: null,
    });
    const answer = await call("POST", `/api/conversations/${chat ?? ""}/close`, {
      reason: "fit_problem",
      failure_reason: "colour_faded",
    });
    expect(answer.status).toBe(400);
    expect(await env.DB.prepare("SELECT state FROM conversations").first()).toEqual({ state: "open" });
  });
});
