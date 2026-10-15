// A client's Care thread, closed and quiet a year, archived (src/domain/care/chat-archive.ts;
// docs/decisions/0207-closed-chats-archived.md): its messages moved to a file in the backups bucket, read back on its
// page and in the client's data export, and deleted with the client. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { archiveQuietThreads, archivedMessages, chatArchiveKey } from "../../../src/domain/care/chat-archive.ts";
import { deleteOldBackups } from "../../../src/domain/platform/backups.ts";
import { readPersonData } from "../../../src/domain/privacy/data-export.ts";
import { appFor, captureLogs, eraseByMobile, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const ARJUN = "+919810000001";
const QUIET = "5f0c2d1e-8a7b-4c6d-9e8f-1a2b3c4d5e6f";

async function thread(id: string, personId: string | null, mobile: string, state: string, lastAt: string) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, closed_at, created_at,
       updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, CASE WHEN ?4 = 'closed' THEN ?5 END, ?5, ?5)`,
  )
    .bind(id, personId, mobile, state, lastAt)
    .run();
}

async function said(threadId: string, direction: "in" | "out" | "note", text: string, at: string) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
  )
    .bind(crypto.randomUUID(), threadId, direction, direction === "in" ? "client" : "care@maneman.test", text, at)
    .run();
}

const rowsOf = async (threadId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?1")
      .bind(threadId)
      .first<{ n: number }>()
  )?.n;

const fileOf = (threadId: string) => archivedMessages(env.BACKUPS, chatArchiveKey(threadId));

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson("p1", ARJUN, "Arjun Mehta");
  await insertPerson("p2", "+919810000002", "Meera Iyer");
  // Closed in August 2025, over a year before NOW.
  await thread(QUIET, "p1", ARJUN, "closed", "2025-08-01T06:00:00.000Z");
  await said(QUIET, "in", "Is the Delhi studio open on Sunday?", "2025-08-01T05:00:00.000Z");
  await said(QUIET, "out", "It is, from ten.", "2025-08-01T05:30:00.000Z");
  await said(QUIET, "note", "Asked twice before.", "2025-08-01T06:00:00.000Z");
  // Closed this month, open now, and a closed thread of a number we never knew.
  await thread("thread-recent", "p2", "+919810000002", "closed", "2026-09-01T06:00:00.000Z");
  await thread("thread-open", null, "+919810000003", "open", "2025-07-01T06:00:00.000Z");
  await thread("thread-stranger", null, "+919810000004", "closed", "2025-07-01T06:00:00.000Z");
  for (const id of ["thread-recent", "thread-open", "thread-stranger"]) {
    await said(id, "in", "Hello?", "2025-07-01T06:00:00.000Z");
  }
});

describe("a closed Care thread, quiet a year", () => {
  it("is moved to its file, and a recent thread, an open one and a stranger's stay", async () => {
    expect(await archiveQuietThreads(env.DB, env.BACKUPS, NOW)).toBe(1);
    expect((await fileOf(QUIET)).map((message) => message.text)).toEqual([
      "Is the Delhi studio open on Sunday?",
      "It is, from ten.",
      "Asked twice before.",
    ]);
    expect(await rowsOf(QUIET)).toBe(0);
    expect(
      await env.DB.prepare("SELECT archive_key, archived_messages FROM conversations WHERE id = ?1")
        .bind(QUIET)
        .first(),
    ).toEqual({ archive_key: chatArchiveKey(QUIET), archived_messages: 3 });
    for (const id of ["thread-recent", "thread-open", "thread-stranger"]) expect(await rowsOf(id)).toBe(1);
    // Archived, it is not read again.
    expect(await archiveQuietThreads(env.DB, env.BACKUPS, NOW)).toBe(0);
  });

  it("shows its messages on its page as before", async () => {
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    const ops = appFor("local", fakeDependencies(), {}, "ops");
    const opened = await (
      await request(ops, `/api/conversations/${QUIET}`)
    ).json<{
      items: { kind: string; text?: string | null }[];
    }>();
    expect(opened.items.map((item) => [item.kind, item.text])).toEqual([
      ["in", "Is the Delhi studio open on Sunday?"],
      ["out", "It is, from ten."],
      ["note", "Asked twice before."],
    ]);
  });

  it("is archived again once quiet a year after the client wrote again, its file holding both", async () => {
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    await said(QUIET, "in", "And on Monday?", "2025-09-01T05:00:00.000Z");
    await env.DB.prepare("UPDATE conversations SET last_message_at = '2025-09-01T05:00:00.000Z' WHERE id = ?1")
      .bind(QUIET)
      .run();

    expect(await archiveQuietThreads(env.DB, env.BACKUPS, NOW)).toBe(1);
    expect((await fileOf(QUIET)).map((message) => message.text)).toHaveLength(4);
    expect(await rowsOf(QUIET)).toBe(0);
  });

  it("is in the client's data export, without staff's notes", async () => {
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    const held = (await readPersonData(env.DB, env.BACKUPS, "p1")) as { chats: { text: string | null }[] };
    expect(held.chats.map((line) => line.text)).toEqual(["Is the Delhi studio open on Sunday?", "It is, from ten."]);
  });

  it("goes with the client's erasure", async () => {
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    await eraseByMobile(ARJUN);
    expect(await env.BACKUPS.get(chatArchiveKey(QUIET))).toBeNull();
    expect(await env.DB.prepare("SELECT archive_key FROM conversations WHERE id = ?1").bind(QUIET).first()).toEqual({
      archive_key: null,
    });
  });

  it("keeps no words of a client erased while it was being written", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind("p1", NOW.toISOString()).run();
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    expect((await fileOf(QUIET)).map((message) => message.text)).toEqual([null, null, null]);
  });

  it("is left be by the weekly backups' pruning", async () => {
    await archiveQuietThreads(env.DB, env.BACKUPS, NOW);
    await env.BACKUPS.put("2026-01-04/manifest.json", "{}");
    expect(await deleteOldBackups(env.BACKUPS, NOW)).toBe(1);
    expect(await fileOf(QUIET)).toHaveLength(3);
  });
});
