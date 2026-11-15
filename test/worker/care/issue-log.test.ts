// The client's issue log (src/routes/client/problem-log.ts; docs/decisions/0258-the-issue-log.md): each report with its
// reference, category, thread and state, read from the Care chat it went into; the client's update, reopening and word
// that it is sorted; and their grievances and missed-visit disputes beside the reports. NOW is Monday 21 September
// 2026, 12 noon in India. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { closeConversation } from "../../../src/domain/care/replies.ts";
import { asClient, client, signedIn } from "../clients.ts";
import { markDatabase, NOW } from "../helpers.ts";

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
  events: { kind: string; name: string | null; text: string | null }[];
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

const careCloses = async (minutes: number) =>
  closeConversation(env.DB, {
    conversationId: await chat(),
    actor: { kind: "staff", id: NEHA },
    requestId: crypto.randomUUID(),
    now: new Date(NOW.getTime() + minutes * 60_000),
    reason: "fit_problem",
  });

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
