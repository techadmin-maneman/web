// A client's record as the technician's card and history and the console's client page give it
// (docs/decisions/0242-client-record.md): the alerts every technician reads before they start, the note left for the
// next technician, and each past visit.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";

export const ClientAlertSchema = z
  .object({
    id: z.uuid(),
    body: z.string(),
    written_at: z.iso.datetime(),
    raised_by: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("staff"), staff: z.string() })
        .strict()
        .openapi({ description: "The member of staff, by their work e-mail." }),
      z
        .object({ kind: z.literal("technician"), name: z.string() })
        .strict()
        .openapi({ description: "The technician, by first name, at a visit's close." }),
    ]),
  })
  .strict()
  .openapi("ClientAlert", { description: 'Read before starting: "Allergic to latex".' });

export const ClientAlertsSchema = z
  .array(ClientAlertSchema)
  .openapi({ description: "The client's alerts still on, newest first." });

const PhotosSchema = z
  .array(z.object({ angle: z.string(), url: z.string() }).strict())
  .openapi({ description: "Its after photographs, never to be kept on the phone." });

export const HandoffSchema = z
  .union([
    z
      .object({
        note: z.string(),
        technician: z.union([z.string(), z.null()]).openapi({ description: "Who left it, by first name." }),
        visit_id: z.uuid(),
        date: z.iso.date().openapi({ description: "The visit it was left at, its day in India." }),
        photos: PhotosSchema,
      })
      .strict(),
    z.null(),
  ])
  .openapi("Handoff", { description: "The note the last technician left for this visit's; null for none." });

export const HistoryVisitSchema = z
  .object({
    id: z.uuid(),
    date: z.iso.date(),
    type: z.enum(VISIT_TYPES),
    technician: z.union([z.string(), z.null()]),
    result: z
      .union([z.string(), z.null()])
      .openapi({ description: "done, partial or no_show; null where ops closed it with no outcome." }),
    note: z.union([z.string(), z.null()]).openapi({ description: "The note its technician left for the next." }),
    photos: PhotosSchema,
    consumables: z.array(z.object({ name: z.string(), quantity: z.number() }).strict()),
    piece: z.union([z.string(), z.null()]).openapi({ description: "The label of the piece fitted at it." }),
  })
  .strict()
  .openapi("TechnicianHistoryVisit");

export const ClientHistorySchema = z
  .object({ alerts: ClientAlertsSchema, visits: z.array(HistoryVisitSchema) })
  .strict()
  .openapi("TechnicianClientHistory", {
    description: "The client's visits closed before this job, newest first, at most twenty.",
  });
