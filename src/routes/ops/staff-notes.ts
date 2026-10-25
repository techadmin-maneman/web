// Staff's notes on a client, at the top of their page in the console (src/domain/clients/staff-notes.ts). On the ops
// surface behind Access.
//
// A change names the note it replaces, and is refused, 409 superseded, once that note is no longer on, so it never
// silently writes over another's change. Each is audited by the client's and the note's IDs, never a word of it.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { notesOf, takeOffNote, writeNote } from "../../domain/clients/staff-notes.ts";
import { STAFF_NOTE_MAX_CHARS } from "../../policy/staff-notes.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const clientId = z.object({ id: z.uuid() });
const noteId = z.object({ id: z.uuid(), note_id: z.uuid() });
const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);
const noStaff = errorResponse("access_required: no Access token, or a service token, which names no member of staff");

const StaffNoteSchema = z
  .object({
    id: z.uuid(),
    body: z.string(),
    written_by: z.string().openapi({ description: "The member of staff's work e-mail." }),
    written_at: z.iso.datetime(),
  })
  .strict()
  .openapi("StaffNote");

const StaffNotesSchema = z
  .object({ notes: z.array(StaffNoteSchema).openapi({ description: "The notes still on, newest first." }) })
  .strict()
  .openapi("StaffNotes");

const NoteWrittenSchema = z
  .object({
    body: z.string().trim().min(1).max(STAFF_NOTE_MAX_CHARS),
    replaces: z
      .union([z.uuid(), z.null()])
      .openapi({ description: "The note this one changes, as the page read it; null for a new note." }),
  })
  .strict()
  .openapi("StaffNoteWritten");

const readRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/notes",
  summary: "Staff's notes on the client still on, newest first",
  request: { params: clientId },
  responses: { 200: { description: "The notes", ...json(StaffNotesSchema) }, 404: unknownClient },
});

const writeRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/notes",
  summary: "Write a note on the client, new or in the place of one, under the member of staff, audited",
  request: { params: clientId, body: { required: true, ...json(NoteWrittenSchema) } },
  responses: {
    201: { description: "Written, and the notes as they now stand", ...json(StaffNotesSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    403: noStaff,
    404: unknownClient,
    409: errorResponse("superseded: the note it replaces is no longer on; read the notes again"),
  },
});

const takeOffRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/notes/{note_id}/take-off",
  summary: "Take a note off the client's page; it is kept, with who took it off and when, audited",
  request: { params: noteId },
  responses: {
    200: { description: "Taken off, or already off, and the notes as they now stand", ...json(StaffNotesSchema) },
    403: noStaff,
    404: unknownClient,
  },
});

const notes = async (c: Context<AppEnv>, personId: string) => ({ notes: await notesOf(c.env.DB, personId) });

export function registerOpsStaffNotes(app: App): void {
  app.openapi(readRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json(await notes(c, id), 200);
  });

  app.openapi(writeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { body, replaces } = c.req.valid("json");
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const written = await writeNote(c.env.DB, {
      personId: id,
      body,
      staff: staff.id,
      replaces,
      now: c.var.deps.now(),
      audit: { surface: "ops", actor: staff, requestId: c.var.requestId },
    });
    if (written === "moved") return refuse(c, "superseded");
    return c.json(await notes(c, id), 201);
  });

  app.openapi(takeOffRoute, async (c) => {
    const { id, note_id: note } = c.req.valid("param");
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    await takeOffNote(c.env.DB, {
      personId: id,
      noteId: note,
      staff: staff.id,
      now: c.var.deps.now(),
      audit: { surface: "ops", actor: staff, requestId: c.var.requestId },
    });
    return c.json(await notes(c, id), 200);
  });
}
