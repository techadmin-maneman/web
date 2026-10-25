// A technician's word to the client from the job card (src/routes/tech/jobs.updates.ts,
// src/domain/messages/technician-updates.ts; docs/decisions/0145-technician-presets.md): sent from our number once
// per event, kept unsent when it reaches us too late to help, and never refused in a way that stops the phone's queue.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { composeTechnicianUpdate } from "../../../src/domain/messages/technician-updates.ts";
import { NOW } from "../helpers.ts";
import { messageQueue, PERSON, post, TODAY_JOB, useFieldDay } from "./field-fixtures.ts";

useFieldDay();

/** A UUIDv7 event ID queued `minutes` before NOW, as the phone makes one. */
function eventAt(minutesBefore: number, tail: string): string {
  const hex = (NOW.getTime() - minutesBefore * 60_000).toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-${tail.padStart(12, "0")}`;
}

const say = (body: unknown, eventId: string) => post(`/api/tech/jobs/${TODAY_JOB}/updates`, body, eventId);

const messages = async () =>
  (
    await env.DB.prepare(
      "SELECT kind, subject_kind, state FROM outbound_messages WHERE kind = 'technician_update' ORDER BY created_at",
    ).all()
  ).results;

describe("a word from the job card", () => {
  it("goes to the client from our number, once however often the phone sends it", async () => {
    const event = eventAt(2, "1");
    expect(await (await say({ preset: "on_the_way", minutes: 20 }, event)).json()).toEqual({ sent: true });
    expect(await (await say({ preset: "on_the_way", minutes: 20 }, event)).json()).toEqual({ sent: false });
    expect(await messages()).toEqual([
      { kind: "technician_update", subject_kind: "technician_update", state: "queued" },
    ]);
    expect(messageQueue.sent).toHaveLength(1);
  });

  it("is kept unsent when the same word went to the client a moment before, from another tap", async () => {
    expect(await (await say({ preset: "on_the_way", minutes: 20 }, eventAt(3, "6"))).json()).toEqual({ sent: true });
    expect(await (await say({ preset: "on_the_way", minutes: 20 }, eventAt(2, "7"))).json()).toEqual({ sent: false });
    expect(await (await say({ preset: "running_late", minutes: 20 }, eventAt(1, "8"))).json()).toEqual({ sent: true });
    expect(await messages()).toEqual([
      { kind: "technician_update", subject_kind: "technician_update", state: "queued" },
      { kind: "technician_update", subject_kind: "technician_update", state: "skipped" },
      { kind: "technician_update", subject_kind: "technician_update", state: "queued" },
    ]);
  });

  it("is kept unsent when it reaches us too late to help", async () => {
    expect(await (await say({ preset: "at_gate", minutes: null }, eventAt(15, "2"))).json()).toEqual({ sent: false });
    expect(await messages()).toEqual([
      { kind: "technician_update", subject_kind: "technician_update", state: "skipped" },
    ]);
  });

  it("takes minutes for on the way and running late, and none at the gate", async () => {
    expect((await say({ preset: "at_gate", minutes: 10 }, eventAt(1, "3"))).status).toBe(400);
    expect((await say({ preset: "running_late", minutes: null }, eventAt(1, "4"))).status).toBe(400);
  });

  it("says who is coming and how long, in the client's message", async () => {
    const event = eventAt(1, "5");
    await say({ preset: "running_late", minutes: 15 }, event);
    expect(await composeTechnicianUpdate(env.DB, event, PERSON, NOW)).toEqual({
      template: "technician_running_late_v1",
      params: ["Rohit", "", "", "", "Imran", "", "", "", "15"],
    });
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(TODAY_JOB).run();
    expect(await composeTechnicianUpdate(env.DB, event, PERSON, NOW)).toEqual({ skip: "the visit has closed" });
  });
});
