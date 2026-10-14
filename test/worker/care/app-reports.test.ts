// Something wrong told to Care from the app (src/routes/client/problems.ts, src/domain/care/app-reports.ts): the
// client's words land in their Care thread, with a note for Care alone of their piece and its warranty, and nothing is
// sent. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { asClient, client, fittedInAugust, signedIn } from "../clients.ts";
import { markDatabase, NOW } from "../helpers.ts";

const ROHIT = "p-rohit";
const MOBILE = "+919810000001";

const report = (cookie: string, body: object) => asClient(cookie, "/api/me/problems", { method: "POST", body });

const thread = () =>
  env.DB.prepare(
    `SELECT m.direction, m.author, m.text FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.mobile_e164 = ?1 ORDER BY m.sent_at`,
  )
    .bind(MOBILE)
    .all();

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await client(ROHIT, MOBILE);
  cookie = await signedIn(ROHIT);
});

describe("something wrong, told from the app", () => {
  it("lands in the client's Care thread with their piece and its warranty beside it for Care", async () => {
    await fittedInAugust(ROHIT);
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, appointment_id, synced_at)
       VALUES ('pc-1', 'pc-1', ?1, 'MM-NAT-4417-A', '2026-08-01T06:00:00.000Z', '2027-02-01T06:00:00.000Z', 'fit-1', ?2)`,
    )
      .bind(ROHIT, NOW.toISOString())
      .run();

    const sent = await report(cookie, { about: "hair_system", text: "It lifts at the front." });
    expect(sent.status).toBe(201);
    expect(await sent.json()).toEqual({ state: "sent" });
    expect((await thread()).results).toEqual([
      { direction: "in", author: "client", text: "Something's wrong with my hair system:\nIt lifts at the front." },
      {
        direction: "note",
        author: "system",
        text:
          "From the app. Piece MM-NAT-4417-A, fitted 1 Aug 2026 · replacement due 1 Feb 2027 · " +
          "no supplier receipt on record",
      },
    ]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first())?.n).toBe(0);
  });

  it("names the visit it is about, and refuses one that is not the client's", async () => {
    await fittedInAugust(ROHIT);
    expect((await report(cookie, { about: "visit", visit_id: crypto.randomUUID(), text: "Late." })).status).toBe(404);

    await env.DB.prepare("UPDATE appointments SET id = '7f1d5a3e-2c4b-4d6e-8f90-a1b2c3d4e5f6' WHERE id = 'fit-1'").run();
    const sent = await report(cookie, {
      about: "visit",
      visit_id: "7f1d5a3e-2c4b-4d6e-8f90-a1b2c3d4e5f6",
      text: "The adhesive itched.",
    });
    expect(sent.status).toBe(201);
    expect((await thread()).results).toMatchObject([
      { direction: "in", text: "Something's wrong with a visit:\nThe adhesive itched." },
      { direction: "note", text: "From the app. About the first fit of Sat 1 Aug with Sana Mirza. No piece on record." },
    ]);
  });

  it("is five a day", async () => {
    for (let n = 0; n < 5; n += 1) {
      expect((await report(cookie, { about: "hair_system", text: `Try ${String(n)}` })).status).toBe(201);
    }
    expect((await report(cookie, { about: "hair_system", text: "Once more" })).status).toBe(429);
  });
});
