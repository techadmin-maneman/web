// The client's issue log (src/routes/client/problem-log.ts; docs/decisions/0258-the-issue-log.md): each report with its
// reference, category, thread and state, read from the Care chat it went into; the client's update, reopening and word
// that it is sorted; and their grievances and missed-visit disputes beside the reports. NOW is Monday 21 September
// 2026, 12 noon in India. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { fileInbound } from "../../../src/domain/care/inbox.ts";
import { closeConversation } from "../../../src/domain/care/replies.ts";
import { deleteErasedFiles } from "../../../src/domain/privacy/erasure-files.ts";
import { asClient, client, fittedInAugust, signedIn } from "../clients.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";

const ROHIT = "p-rohit";
const PRIYA = "p-priya";
const NEHA = "neha@maneman.in";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, "+919810000001");
  await client(PRIYA, "+919810000002", "Priya Sharma");
  cookie = await signedIn(ROHIT);
  await env.DB.prepare("INSERT INTO care_names (email, name, set_by, set_at) VALUES (?1, 'Neha', 'ops@localhost', ?2)")
    .bind(NEHA, NOW.toISOString())
    .run();
});

type Issue = {
  kind: string;
  reference: string | null;
  category: string | null;
  state: string;
  events: { at: string; kind: string; name: string | null; text: string | null }[];
};

/** `minutes` after NOW. */
const after = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const report = (body: object, as = cookie, minutes = 0) =>
  asClient(as, "/api/me/problems", { method: "POST", body }, { now: after(minutes) });
const log = async (as = cookie) => (await (await asClient(as, "/api/me/problems")).json<{ issues: Issue[] }>()).issues;
const add = (reference: string, what: "updates" | "reopen" | "sorted", minutes: number, text?: string) =>
  asClient(
    cookie,
    `/api/me/problems/${reference}/${what}`,
    { method: "POST", ...(text === undefined ? {} : { body: { text } }) },
    { now: after(minutes) },
  );

const chat = async () =>
  (await env.DB.prepare("SELECT id FROM conversations WHERE person_id = ?1").bind(ROHIT).first<string>("id")) ?? "";

/** Care's reply, `minutes` after NOW. */
async function careReplies(text: string, minutes: number) {
  const at = new Date(NOW.getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
     VALUES (?1, ?2, 'out', ?3, ?4, ?5, ?5, 'sent')`,
  )
    .bind(crypto.randomUUID(), await chat(), NEHA, text, at)
    .run();
}

const careCloses = async (minutes: number, conversationId?: string) =>
  closeConversation(env.DB, {
    conversationId: conversationId ?? (await chat()),
    actor: { kind: "staff", id: NEHA },
    requestId: crypto.randomUUID(),
    now: new Date(NOW.getTime() + minutes * 60_000),
    reason: "fit_problem",
  });

/** The reason Care's close of the client's chat opens on. */
const closeReason = async (conversationId?: string) =>
  (
    await (
      await request(
        appFor("local", fakeDependencies(), {}, "ops"),
        `/api/conversations/${conversationId ?? (await chat())}`,
      )
    ).json<{ close_reason: string | null }>()
  ).close_reason;

const NEW_NUMBER = "+919810000099";

/** The client's number changed to NEW_NUMBER, `minutes` after NOW. */
const changesNumber = (minutes: number) =>
  env.DB.batch([
    env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at, decided_by,
         replaced_mobile_e164)
       VALUES ('nc-1', ?1, ?2, ?3, 'confirmed', ?4, 'ops@localhost', '+919810000001')`,
    ).bind(ROHIT, NOW.toISOString(), NEW_NUMBER, after(minutes).toISOString()),
    env.DB.prepare("UPDATE people SET mobile_e164 = ?2 WHERE id = ?1").bind(ROHIT, NEW_NUMBER),
  ]);

const chatOn = async (mobile: string) =>
  (await env.DB.prepare("SELECT id FROM conversations WHERE mobile_e164 = ?1").bind(mobile).first<string>("id")) ?? "";

describe("the issue log", () => {
  it("lists a report by its reference and category, open until Care answer, in progress, then resolved", async () => {
    const sent = await report({ about: "edges_lifting", text: "The front lifts after the gym." });
    expect(await sent.json()).toEqual({ state: "sent", reference: "MM-ISS-0001" });
    expect(await log()).toEqual([
      expect.objectContaining({ kind: "report", reference: "MM-ISS-0001", category: "edges_lifting", state: "open" }),
    ]);

    await careReplies("Your technician will re-bond it on the 22nd.", 20);
    const [answered] = await log();
    expect(answered?.state).toBe("in_progress");
    expect(answered?.events.map((event) => [event.kind, event.name, event.text])).toEqual([
      ["you", null, "The front lifts after the gym."],
      ["care", "Neha", "Your technician will re-bond it on the 22nd."],
    ]);

    await careCloses(30);
    expect((await log())[0]).toMatchObject({ state: "resolved" });
  });

  it("gives each report the stretch of the chat until the next, and numbers them in turn", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    await careReplies("Refund started.", 5);
    // A while on, another report: what follows it is its own.
    const later = await report({ about: "itching", text: "It itches since Monday." }, cookie, 3_000);
    expect(await later.json()).toMatchObject({ reference: "MM-ISS-0002" });
    await careReplies("Try the aftercare spray.", 6_000);
    const [itching, refund] = await log();
    expect(itching?.events.map((event) => event.text)).toEqual(["It itches since Monday.", "Try the aftercare spray."]);
    expect(refund?.events.map((event) => event.text)).toEqual(["When does the refund land?", "Refund started."]);
  });

  it("takes the client's update, their word it is sorted, and a reopening, each into the chat", async () => {
    await report({ about: "shedding", text: "Hair on the pillow." });
    expect((await add("MM-ISS-0001", "updates", 1, "More this morning.")).status).toBe(204);
    expect((await add("MM-ISS-0001", "sorted", 2)).status).toBe(204);
    expect((await log())[0]).toMatchObject({ state: "resolved" });

    expect((await add("MM-ISS-0001", "reopen", 3, "It is back.")).status).toBe(204);
    expect((await log())[0]).toMatchObject({ state: "open" });
    const words = await env.DB.prepare(
      "SELECT text FROM chat_messages WHERE direction = 'in' ORDER BY sent_at, rowid",
    ).all<{ text: string }>();
    expect(words.results.map((row) => row.text)).toEqual([
      "MM-ISS-0001 · Shedding:\nHair on the pillow.",
      "MM-ISS-0001 · Update:\nMore this morning.",
      "MM-ISS-0001 · Reopened:\nIt is back.",
    ]);

    // Care's next close settles it again, reopened as it was.
    await careCloses(10);
    expect((await log())[0]).toMatchObject({ state: "resolved" });
  });

  it("opens Care's close on the reason its latest open report maps to, and on none once it is closed", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    const thread = () => closeReason();
    expect(await thread()).toBe("billing");
    await careCloses(5);
    expect(await thread()).toBeNull();
    // The client writes again: the report reads open, and the close opens on its reason once more.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
         VALUES ('m-again', ?1, 'in', 'client', 'Still nothing.', ?2, ?2)`,
      ).bind(await chat(), after(10).toISOString()),
      env.DB.prepare("UPDATE conversations SET last_inbound_at = ?2, state = 'open' WHERE id = ?1").bind(
        await chat(),
        after(10).toISOString(),
      ),
    ]);
    expect(await thread()).toBe("billing");
  });

  it("shows nothing of the old number's chat once the client has changed number, whoever holds it now", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    await careReplies("We will re-bond it.", 5);
    const old = await chat();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at, decided_by,
           replaced_mobile_e164)
         VALUES ('nc-1', ?1, ?2, '+919810000099', 'confirmed', ?3, 'ops@localhost', '+919810000001')`,
      ).bind(ROHIT, NOW.toISOString(), after(10).toISOString()),
      env.DB.prepare("UPDATE people SET mobile_e164 = '+919810000099' WHERE id = ?1").bind(ROHIT),
    ]);
    // The old number is someone else's now: they write, and Care answer them, in the old chat.
    await env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
       VALUES ('m-stranger', ?1, 'in', 'client', 'Who is this?', ?2, ?2)`,
    )
      .bind(old, after(20).toISOString())
      .run();
    await careReplies("Hello, how can we help?", 25);
    expect((await log())[0]?.events.map((event) => event.text)).toEqual(["The front lifts.", "We will re-bond it."]);
    // Care closing the old chat, for whoever holds the number now, settles nothing of the client's.
    await careCloses(30);
    expect((await log())[0]).toMatchObject({ state: "in_progress" });
  });

  it("settles at Care's next close a settled report the client wrote on again in the chat before their next", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    await careCloses(10);
    await fileInbound(env.DB, {
      mobileE164: "+919810000001",
      text: "Thanks, but nothing yet.",
      providerMessageId: null,
      at: after(20),
    });
    await report({ about: "itching", text: "It itches since Monday." }, cookie, 60);
    expect((await log())[1]).toMatchObject({ reference: "MM-ISS-0001", state: "open" });
    await careCloses(120);
    const [itching, refund] = await log();
    expect([itching?.state, refund?.state]).toEqual(["resolved", "resolved"]);
    expect(refund?.events.find((event) => event.kind === "closed")?.at).toBe(after(120).toISOString());
  });

  it("opens Care's close on none once every report is settled, and on an earlier one the client reopens", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    await careCloses(10);
    await report({ about: "itching", text: "It itches since Monday." }, cookie, 60);
    await careCloses(120);
    expect(await closeReason()).toBeNull();
    expect((await add("MM-ISS-0001", "reopen", 150, "The refund never came.")).status).toBe(204);
    expect(await closeReason()).toBe("billing");
  });

  it("shows none of the earlier holder's words in the chat on a number the client moved to", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    // The number was another's, who wrote in its chat as if to the client's report.
    await fileInbound(env.DB, {
      mobileE164: NEW_NUMBER,
      text: "MM-ISS-0001 · Update:\nNot mine at all.",
      providerMessageId: null,
      at: after(5),
    });
    await changesNumber(10);
    await report({ about: "itching", text: "It itches." }, cookie, 20);
    const [itching, lifting] = await log();
    expect(lifting?.events.map((event) => event.text)).toEqual(["The front lifts."]);
    expect(itching?.events.map((event) => event.text)).toEqual(["It itches."]);
  });

  it("counts the after-hours answer as no reply from Care", async () => {
    await report({ about: "shedding", text: "Hair on the pillow." });
    await env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
       VALUES ('m-auto', ?1, 'out', 'auto', 'Care are back at 9 am.', ?2, ?2, 'sent')`,
    )
      .bind(await chat(), after(1).toISOString())
      .run();
    const [shedding] = await log();
    expect(shedding).toMatchObject({ state: "open" });
    expect(shedding?.events.map((event) => event.kind)).toEqual(["you"]);
  });

  it("keeps a settled report's close where it was when Care close the chat for a later one", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    await careCloses(10);
    await report({ about: "itching", text: "It itches since Monday." }, cookie, 60);
    await careCloses(120);
    const [, refund] = await log();
    expect(refund?.events.find((event) => event.kind === "closed")?.at).toBe(after(10).toISOString());
  });

  it("files an update under the report it names, in the client's own words, however many reports came since", async () => {
    await report({ about: "payment", text: "When does the refund land?" });
    await report({ about: "itching", text: "It itches since Monday." }, cookie, 60);
    expect((await add("MM-ISS-0001", "updates", 120, "Still nothing in my account.")).status).toBe(204);
    const [itching, refund] = await log();
    expect(refund?.events.map((event) => event.text)).toEqual([
      "When does the refund land?",
      "Still nothing in my account.",
    ]);
    expect(itching?.events.map((event) => event.text)).toEqual(["It itches since Monday."]);
  });

  it("reads open again once the client writes in the chat after Care closed it", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    await careCloses(10);
    expect((await log())[0]).toMatchObject({ state: "resolved" });
    await env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
       VALUES ('m-again', ?1, 'in', 'client', 'Still lifting.', ?2, ?2)`,
    )
      .bind(await chat(), after(20).toISOString())
      .run();
    expect((await log())[0]).toMatchObject({ state: "open" });
    // And Care's next close settles it once more.
    await careCloses(30);
    expect((await log())[0]).toMatchObject({ state: "resolved" });
  });

  it("takes twenty additions a day to the client's reports", async () => {
    await report({ about: "other", text: "Something else." });
    for (let n = 1; n <= 20; n += 1) {
      expect((await add("MM-ISS-0001", "updates", n, `Note ${String(n)}`)).status).toBe(204);
    }
    expect((await add("MM-ISS-0001", "updates", 21, "Once more")).status).toBe(429);
  });

  it("lists a missed-visit dispute with its ruling", async () => {
    await fittedInAugust(ROHIT);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-1', 'fit-1', 't-fit', ?1, 28.4, 77.0, 200, 1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           created_at)
         VALUES ('case-1', 'checkin-1', 'fit-1', ?1, ?1, ?1, 'charged', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at, ruling, ruled_by, ruled_at)
         VALUES ('d-1', 'case-1', ?1, 'I was home all morning.', ?2, 'refunded', 'ops@localhost', ?3)`,
      ).bind(ROHIT, after(1).toISOString(), after(2).toISOString()),
    ]);
    expect(await log()).toEqual([
      expect.objectContaining({
        kind: "dispute",
        state: "resolved",
        visit_id: "fit-1",
        events: [
          expect.objectContaining({ kind: "you", text: "I was home all morning." }),
          expect.objectContaining({ kind: "ruled", text: "refunded" }),
        ],
      }),
    ]);
  });

  it("never shows, or takes words on, another client's report", async () => {
    const priya = await signedIn(PRIYA);
    await report({ about: "colour", text: "It looks brassy." }, priya);
    expect(await log()).toEqual([]);
    expect((await add("MM-ISS-0001", "updates", 1, "Mine now.")).status).toBe(404);
    expect((await add("MM-ISS-0001", "sorted", 1)).status).toBe(404);
    expect((await add("not-a-reference", "sorted", 1)).status).toBe(404);
  });

  it("lists the client's grievances and missed-visit disputes beside the reports, each with its state", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO grievances (id, person_id, text, state, response, resolved_at, created_at) VALUES ('g-1', ?1, 'My data was shared.', 'resolved', 'It was not; here is why.', ?2, ?2)",
      ).bind(ROHIT, NOW.toISOString()),
    ]);
    const issues = await log();
    expect(issues).toEqual([
      expect.objectContaining({
        kind: "grievance",
        state: "resolved",
        events: [
          expect.objectContaining({ kind: "you", text: "My data was shared." }),
          expect.objectContaining({ kind: "ruled", text: "It was not; here is why." }),
        ],
      }),
    ]);
  });
});

describe("a report's photographs", () => {
  const send = (bytes: Uint8Array, reference = "MM-ISS-0001", minutes = 0) =>
    request(
      appFor("local", fakeDependencies({ now: () => after(minutes) }), {}, "client"),
      `/api/me/problems/${reference}/photos`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body: bytes,
      },
    );
  const ops = () => appFor("local", fakeDependencies(), {}, "ops");

  it("takes three JPEGs a report, tells Care in its chat, and lets Care see them", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    for (let n = 1; n <= 3; n += 1) {
      const sent = await send(syntheticJpeg(640, 480, `photo ${String(n)}`));
      expect(await sent.json()).toEqual({ n });
    }
    const fourth = await send(syntheticJpeg(640, 480));
    expect(fourth.status).toBe(409);
    // Its file was kept a moment and deleted again: three objects, three rows, nothing more counted.
    expect((await env.CLIENT_PHOTOS.list({ prefix: `reports/${ROHIT}/` })).objects).toHaveLength(3);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM stored_objects WHERE key LIKE ?1")
        .bind(`reports/${ROHIT}/%`)
        .first("n"),
    ).toBe(3);
    expect(await fourth.json()).toMatchObject({ error: { code: "photos_full" } });
    expect((await log())[0]).toMatchObject({ photos: 3 });
    const notes = await env.DB.prepare(
      "SELECT text FROM chat_messages WHERE direction = 'note' AND text LIKE 'MM-ISS-0001:%'",
    ).all();
    expect(notes.results).toHaveLength(3);

    const listed = await request(ops(), `/api/conversations/${await chat()}/report-photos`);
    const { photos } = await listed.json<{ photos: { report_id: string; reference: string; n: number }[] }>();
    expect(photos.map((photo) => [photo.reference, photo.n])).toEqual([
      ["MM-ISS-0001", 1],
      ["MM-ISS-0001", 2],
      ["MM-ISS-0001", 3],
    ]);
    const file = await request(
      ops(),
      `/api/conversations/${await chat()}/report-photos/${photos[0]?.report_id ?? ""}/1`,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("tells Care of a photograph sent after a change of number in a chat on the new one, whose close settles it", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    const old = await chat();
    await changesNumber(10);
    expect(await send(syntheticJpeg(640, 480), "MM-ISS-0001", 20)).toHaveProperty("status", 201);
    const fresh = await chatOn(NEW_NUMBER);
    expect(fresh).not.toBe("");
    expect(
      await env.DB.prepare("SELECT state, last_inbound_at FROM conversations WHERE id = ?1").bind(fresh).first(),
    ).toEqual({ state: "open", last_inbound_at: null });
    expect(
      await env.DB.prepare(
        "SELECT conversation_id FROM chat_messages WHERE text = 'MM-ISS-0001: photo 1 of 3 came.'",
      ).all(),
    ).toMatchObject({ results: [{ conversation_id: fresh }] });
    const listed = await request(ops(), `/api/conversations/${fresh}/report-photos`);
    expect((await listed.json<{ photos: unknown[] }>()).photos).toHaveLength(1);
    expect(await closeReason(fresh)).toBe("fit_problem");

    await careCloses(30, fresh);
    expect((await log())[0]).toMatchObject({ state: "resolved" });
    expect(old).not.toBe(fresh);
  });

  it("reopens a closed chat with a photograph's note", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    await careCloses(10);
    await send(syntheticJpeg(640, 480), "MM-ISS-0001", 20);
    expect(
      await env.DB.prepare("SELECT state FROM conversations WHERE id = ?1")
        .bind(await chat())
        .first("state"),
    ).toBe("open");
  });

  it("serves Care no photograph through another client's chat", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    await send(syntheticJpeg(640, 480));
    const priya = await signedIn(PRIYA);
    await report({ about: "colour", text: "It looks brassy." }, priya);
    const theirs = await env.DB.prepare("SELECT id FROM conversations WHERE person_id = ?1")
      .bind(PRIYA)
      .first<string>("id");
    const ours = await env.DB.prepare("SELECT id FROM client_reports WHERE person_id = ?1")
      .bind(ROHIT)
      .first<string>("id");
    const file = await request(ops(), `/api/conversations/${theirs ?? ""}/report-photos/${ours ?? ""}/1`);
    expect(file.status).toBe(404);
  });

  it("goes with the client's erasure, the files before their rows", async () => {
    await report({ about: "edges_lifting", text: "The front lifts." });
    await send(syntheticJpeg(640, 480));
    const kept = await env.DB.prepare("SELECT object_key FROM client_report_photos").first<string>("object_key");
    expect(await env.CLIENT_PHOTOS.head(kept ?? "")).not.toBeNull();
    await deleteErasedFiles(env, ROHIT, NOW);
    expect(await env.CLIENT_PHOTOS.head(kept ?? "")).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_report_photos").first("n")).toBe(0);
  });

  it("refuses anything but a JPEG, and a report that is not the client's", async () => {
    await report({ about: "colour", text: "It looks brassy." });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await send(png)).status).toBe(422);
    expect((await send(syntheticJpeg(64, 64), "MM-ISS-0099")).status).toBe(404);
  });
});
