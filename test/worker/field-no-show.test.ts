// A client not home: the wait, and the case ops rule on.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { NOW, request } from "./helpers.ts";
import {
  AT_THE_DOOR,
  bindings,
  cookie,
  minutesAfterStart,
  ops,
  opsPost,
  PERSON,
  post,
  postAt,
  startJob,
  techAt,
  TODAY_JOB,
  TODAY_START,
  useFieldDay,
} from "./field-fixtures.ts";

useFieldDay();

describe("the no-show", () => {
  it("is refused before the wait ends, then closes with its three facts", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const early = await post(`/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-noshow-01");
    expect(early.status).toBe(425);
    expect(await early.json()).toMatchObject({ error: { code: "too_early_to_close" } });

    // The day-before WhatsApp, delivered: the third fact ops rule on.
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, sent_at,
         delivered_at)
       VALUES ('m1', ?1, ?2, 'visit_reminder', 'appointment', ?3, 'sent', ?1, ?1)`,
    )
      .bind(NOW.toISOString(), PERSON, TODAY_JOB)
      .run();

    // He checked in an hour early, so sixteen minutes on the client's wait has not even begun.
    const beforeTheStart = await postAt(
      new Date(NOW.getTime() + 16 * 60_000),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      undefined,
      "event-noshow-01",
    );
    expect(beforeTheStart.status).toBe(425);

    // Sixteen minutes after the booked start the wait has run.
    const later = minutesAfterStart(16);
    const closed = await request(
      techAt(later),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "X-Client-Event-Id": "event-noshow-01" },
      },
      bindings(),
    );
    expect(closed.status).toBe(200);
    const body = await closed.json<{ closed: boolean; case_id: string | null }>();
    expect(body.closed).toBe(true);
    expect(body.case_id).not.toBeNull();
    const wait = await env.DB.prepare("SELECT wait_started_at, wait_ends_at FROM no_show_cases").first();
    expect(wait).toEqual({
      wait_started_at: TODAY_START.toISOString(),
      wait_ends_at: minutesAfterStart(15).toISOString(),
    });

    const cases = await (
      await request(ops, "/api/no-shows", {}, bindings())
    ).json<{
      cases: { id: string; distance_m: number; message_delivered_at: string | null; decision: string }[];
    }>();
    expect(cases.cases).toHaveLength(1);
    // The three facts, and nothing else: when he arrived, how far away, and the receipt.
    expect(cases.cases[0]).toMatchObject({
      decision: "undecided",
      checked_in_at: NOW.toISOString(),
      message_delivered_at: NOW.toISOString(),
      minutes_late: -60,
      closed_early: false,
    });
    expect(cases.cases[0]?.distance_m).toBeLessThan(200);

    // Nothing is charged automatically: a person rules on it.
    const ruled = await opsPost(`/api/no-shows/${cases.cases[0]?.id ?? ""}/decision`, {
      decision: "charged",
      reason: "Delivered the evening before, and nobody came to the door",
    });
    expect(ruled.status).toBe(200);
    const after = await env.DB.prepare("SELECT decision, decided_by FROM no_show_cases").first<{
      decision: string;
      decided_by: string;
    }>();
    expect(after?.decision).toBe("charged");
    expect(after?.decided_by).not.toBe("");
  });

  it("is refused once the job has started, and opens no case", async () => {
    await startJob();

    const answer = await postAt(minutesAfterStart(15), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_started" } });
    const cases = await env.DB.prepare("SELECT COUNT(*) AS n FROM no_show_cases").first<{ n: number }>();
    expect(cases?.n).toBe(0);
  });

  // ADR 0036: "An address with no coordinates cannot be measured against ... It is
  // never silently treated as a pass at zero metres." The row names no address and
  // holds no distance (migration 0035), where it once held a filler 0.
  it("carries no distance when the address had no coordinates to measure against", async () => {
    await env.DB.prepare("UPDATE addresses SET lat = NULL, lng = NULL WHERE id = 'addr-1'").run();
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    // Sixteen minutes after the booked start the wait has run, and the technician closes the job.
    const later = minutesAfterStart(16);
    const closed = await request(
      techAt(later),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "X-Client-Event-Id": "event-noshow-01" },
      },
      bindings(),
    );
    expect(closed.status).toBe(200);

    const row = await env.DB.prepare("SELECT address_id, distance_m FROM checkins WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ address_id: string | null; distance_m: number | null }>();
    expect(row).toMatchObject({ address_id: null, distance_m: null });

    const body = await (await request(ops, "/api/no-shows", {}, bindings())).text();
    const cases = (JSON.parse(body) as { cases: { distance_m: number | null }[] }).cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]?.distance_m).toBeNull();
    // The 0 in the column must not reach ops as fact two under any spelling.
    expect(body).not.toContain('"distance_m":0');
  });
});
