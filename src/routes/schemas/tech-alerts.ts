// A technician's alerts as the phone reads them (src/routes/tech/alerts.ts): the inbox, the kinds on, and the key the
// phone subscribes to pushes with. The service worker reads the same inbox to word a push (apps/tech/sw/notice.ts).

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { ALERT_KINDS, ALERT_SETTINGS } from "../../policy/tech-alerts.ts";

const instant = z.iso.datetime().nullable();

const TechAlertSchema = z
  .object({
    id: z.string(),
    kind: z.enum(ALERT_KINDS),
    read: z.boolean(),
    sent_at: z.iso.datetime(),
    job_id: z.string().nullable().openapi({ description: "The job it is about; the day ahead's first job." }),
    date: z.iso.date().openapi({ description: "India's date of the job, or of the day ahead." }),
    type: z.enum(VISIT_TYPES).nullable().openapi({ description: "Null once the job is no longer the technician's." }),
    sector: z.string().nullable(),
    client_name: z
      .string()
      .nullable()
      .openapi({ description: "While the job is the technician's and unlocked; null otherwise." }),
    starts_at: instant,
    was_starts_at: instant.openapi({ description: "A moved job's start before the move." }),
    leave_by: instant.openapi({ description: "Time to leave: when to set off." }),
    drive_minutes: z.number().int().nonnegative().nullable(),
    finish_by: instant.openapi({ description: "Running over: when the job under way must be done." }),
    jobs: z.number().int().positive().nullable().openapi({ description: "The day ahead: how many jobs." }),
    navigate: z
      .string()
      .nullable()
      .openapi({ description: "Navigate's map link, for an alert about driving to a job that is unlocked." }),
  })
  .strict()
  .openapi("TechnicianAlert");

export const AlertSettingsSchema = z
  .object(
    Object.fromEntries(ALERT_SETTINGS.map((kind) => [kind, z.boolean()])) as Record<
      (typeof ALERT_SETTINGS)[number],
      z.ZodBoolean
    >,
  )
  .strict()
  .openapi("TechnicianAlertSettings");

export const AlertSettingsChangeSchema = z
  .object(
    Object.fromEntries(ALERT_SETTINGS.map((kind) => [kind, z.boolean().optional()])) as Record<
      (typeof ALERT_SETTINGS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict()
  .openapi("TechnicianAlertSettingsChange");

export const AlertsSchema = z
  .object({
    alerts: z.array(TechAlertSchema).openapi({ description: "The last seven days', newest first." }),
    settings: AlertSettingsSchema,
    leave_notice_min: z
      .number()
      .int()
      .positive()
      .openapi({ description: "How long before setting off, as ops set it." }),
    day_ahead_hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .openapi({ description: "The hour of India's day the next day's jobs are sent, as ops set it." }),
    push_key: z
      .string()
      .nullable()
      .openapi({ description: "The public key to subscribe to pushes with; null where pushes are not sent." }),
  })
  .strict()
  .openapi("TechnicianAlerts");
