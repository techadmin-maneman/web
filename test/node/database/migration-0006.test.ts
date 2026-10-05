// Migration 0006 rebuilds outbound_messages (docs/decisions/0041-outbound-messages-for-phase-2.md).
// Staging and production hold Phase 1's messages, so the rebuild must carry
// every one of them across unchanged. D1 is SQLite: this applies the real
// migration files to an in-memory SQLite database, before and after.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseThrough } from "./migrations.ts";

function migratedTo(last: string): DatabaseSync {
  const db = databaseThrough(last);
  return db;
}

const PHASE_1_COLUMNS =
  "id, created_at, person_id, kind, subject_id, state, queued_at, sending_at, provider_message_id, attempts, last_error, sent_at";

describe("migration 0006", () => {
  it("carries every Phase 1 message across unchanged, as about a try-on job", () => {
    const db = migratedTo("0005_audit.sql");
    db.exec(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-20T00:00:00Z', '+919810000001', 'A', 1)",
    );
    const insert = db.prepare(
      `INSERT INTO outbound_messages (${PHASE_1_COLUMNS}) VALUES (?, ?, 'p1', 'tryon_result', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      "m-sent",
      "2026-09-20T01:00:00Z",
      "job-1",
      "sent",
      "2026-09-20T01:00:01Z",
      null,
      "3EB0AA",
      1,
      null,
      "2026-09-20T01:00:05Z",
    );
    insert.run(
      "m-failed",
      "2026-09-20T02:00:00Z",
      "job-2",
      "failed",
      "2026-09-20T02:00:01Z",
      null,
      null,
      4,
      "HTTP 500 INTERNAL",
      null,
    );
    insert.run(
      "m-queued",
      "2026-09-20T03:00:00Z",
      "job-3",
      "queued",
      "2026-09-20T03:00:01Z",
      "2026-09-20T03:00:02Z",
      null,
      1,
      null,
      null,
    );
    const before = db.prepare(`SELECT ${PHASE_1_COLUMNS} FROM outbound_messages ORDER BY id`).all();

    apply(db, "0006_outbound_messages_v2.sql");

    expect(db.prepare(`SELECT ${PHASE_1_COLUMNS} FROM outbound_messages ORDER BY id`).all()).toEqual(before);
    expect(db.prepare("SELECT DISTINCT subject_kind, delivered_at, read_at FROM outbound_messages").all()).toEqual([
      { subject_kind: "tryon_job", delivered_at: null, read_at: null },
    ]);
  });

  it("leaves no copy behind, keeps the indexes, and keeps the link to people", () => {
    const db = migratedTo("0006_outbound_messages_v2.sql");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'outbound%'").all();
    expect(tables).toEqual([{ name: "outbound_messages" }]);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbound_messages' AND sql IS NOT NULL ORDER BY name",
      )
      .all();
    expect(indexes).toEqual([
      { name: "outbound_messages_by_provider_id" },
      { name: "outbound_messages_by_state" },
      { name: "outbound_messages_by_subject" },
    ]);
    expect(() => {
      db.exec(
        "INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state) VALUES ('m', 't', 'nobody', 'tryon_result', 's', 'queued')",
      );
    }).toThrow(/FOREIGN KEY/);
  });
});
