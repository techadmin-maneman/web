// A technician's open ask that ops move a visit, as the job's card carries it and the ask answers it
// (src/routes/tech/reschedule.ts, src/routes/tech/jobs.schemas.ts).

import { z } from "@hono/zod-openapi";
import { RESCHEDULE_REASONS } from "../../domain/dispatch/reschedule-requests.ts";

export const RescheduleAskedSchema = z
  .object({
    asked_at: z.iso.datetime(),
    reason: z.enum(RESCHEDULE_REASONS),
  })
  .strict()
  .openapi("TechnicianRescheduleAsked");
