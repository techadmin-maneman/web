// Staff's notes on a client (src/routes/ops/staff-notes.ts): written, changed in the place of the one before, taken
// off, and kept all the while; a change made over another's is refused, and the audit log names the note, never a
// word of it. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { anAddress, aPerson } from "../fixtures/index.ts";

interface Notes {
  notes: { id: string; body: string; written_by: string; written_at: string }[];
}

const send = (path: string, body?: object) =>
  request(appFor("local", fakeDependencies(), {}, "ops"), path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let client: string;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  client = crypto.randomUUID();
  await aPerson({ id: client });
  await anAddress(client);
});

describe("staff's notes on a client", () => {
  it("writes a note, changes it in its place, and takes it off, keeping every one", async () => {
    const written = await send(`/api/clients/${client}/notes`, { body: "Prefers mornings.", replaces: null });
    expect(written.status).toBe(201);
    const [first] = (await written.json<Notes>()).notes;
    expect(first).toMatchObject({ body: "Prefers mornings." });

    const changed = await send(`/api/clients/${client}/notes`, {
      body: "Prefers early mornings.",
      replaces: first?.id,
    });
    const { notes } = await changed.json<Notes>();
    expect(notes.map((note) => note.body)).toEqual(["Prefers early mornings."]);

    const off = await send(`/api/clients/${client}/notes/${notes[0]?.id ?? ""}/take-off`, {});
    expect((await off.json<Notes>()).notes).toEqual([]);
    expect((await (await send(`/api/clients/${client}/notes`)).json<Notes>()).notes).toEqual([]);

    const kept = await env.DB.prepare(
      "SELECT body, replaces IS NOT NULL AS replaced, taken_off_at IS NOT NULL AS off FROM staff_notes ORDER BY written_at, rowid",
    ).all();
    expect(kept.results).toEqual([
      { body: "Prefers mornings.", replaced: 0, off: 1 },
      { body: "Prefers early mornings.", replaced: 1, off: 1 },
    ]);
    const audit = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'staff_note.%'").all<{
      action: string;
      detail: string;
    }>();
    expect(audit.results.map((row) => row.action)).toEqual([
      "staff_note.write",
      "staff_note.write",
      "staff_note.take_off",
    ]);
    expect(audit.results.some((row) => row.detail.includes("mornings"))).toBe(false);
  });

  it("refuses a change to a note another member of staff has changed since it was read", async () => {
    const [first] = (
      await (await send(`/api/clients/${client}/notes`, { body: "Sensitive scalp.", replaces: null })).json<Notes>()
    ).notes;
    await send(`/api/clients/${client}/notes`, { body: "Sensitive scalp; no glue.", replaces: first?.id });
    const late = await send(`/api/clients/${client}/notes`, { body: "Sensitive scalp!", replaces: first?.id });
    expect(late.status).toBe(409);
    const { notes } = await (await send(`/api/clients/${client}/notes`)).json<Notes>();
    expect(notes.map((note) => note.body)).toEqual(["Sensitive scalp; no glue."]);
  });

  it("refuses an empty note, and a note on no client", async () => {
    expect((await send(`/api/clients/${client}/notes`, { body: "  ", replaces: null })).status).toBe(400);
    const nobody = "99999999-9999-4999-8999-999999999999";
    expect((await send(`/api/clients/${nobody}/notes`, { body: "Hello.", replaces: null })).status).toBe(404);
  });
});
