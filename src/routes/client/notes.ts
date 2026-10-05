// A client's note on one of their visits (src/domain/client-notes.ts). Behind
// SELF_SERVE_BOOKING, as the brief puts it among booking's routes: while it is
// off, the app sends the note to ops on WhatsApp instead (ADR 0043).
//
//   POST /api/appointments/:id/note   { note }: kept on the visit, for the technician's card

import { z } from "@hono/zod-openapi";
import { selfServeRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { saveClientNote } from "../../domain/client-notes.ts";
import { CLIENT_NOTE_MAX_CHARS } from "../../policy/client-notes.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { clientOf } from "../../http/client-session.ts";

const NoteSchema = z
  .object({
    note: z.string().trim().min(1).max(CLIENT_NOTE_MAX_CHARS).openapi({
      description: "What the technician should know at the door. Replaces any note before it.",
    }),
  })
  .strict()
  .openapi("VisitNote");

const NotedSchema = z.object({ note: z.string(), noted_at: z.iso.datetime() }).strict().openapi("VisitNoted");

const noteRoute = selfServeRoute({
  method: "post",
  path: "/api/appointments/{id}/note",
  summary: "Leave the technician a note on a visit to come",
  request: {
    params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }),
    body: { required: true, content: { "application/json": { schema: NoteSchema } } },
  },
  responses: {
    200: { description: "Kept on the visit", content: { "application/json": { schema: NotedSchema } } },
    400: errorResponse("invalid_request: an empty note, or one over 500 characters"),
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such visit of this client's"),
    409: errorResponse("not_changeable: the visit is over or cancelled; or ops_assisted: self-serve booking is off"),
  },
});

export function registerClientNotes(app: App): void {
  app.openapi(noteRoute, async (c) => {
    const session = clientOf(c);
    const visitId = c.req.valid("param").id;

    const saved = await saveClientNote(c.env.DB, {
      personId: session.subjectId,
      visitId,
      note: c.req.valid("json").note,
      now: c.var.deps.now(),
    });
    if (saved.kind === "not_found") return refuse(c, "not_found");
    if (saved.kind === "closed") return refuse(c, "not_changeable");
    return c.json({ note: saved.note, noted_at: saved.notedAt }, 200);
  });
}
