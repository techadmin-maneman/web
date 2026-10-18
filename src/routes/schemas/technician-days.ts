// A technician's week and home as the console reads and sets them (docs/decisions/0210-booking-by-start-time.md).

import { z } from "@hono/zod-openapi";

export const DayTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/)
  .openapi({ description: "India's clock, on the quarter hour: 09:00, 17:30." });

export const WorkingDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6).openapi({ description: "0 for Sunday to 6 for Saturday." }),
    starts: DayTime,
    ends: DayTime,
  })
  .strict()
  .openapi("WorkingDay");

export const HomeSchema = z
  .object({ label: z.string().openapi({ description: "The place, as Google writes its address." }) })
  .strict()
  .openapi("TechnicianHome", { description: "Where the technician's day starts, and the drive to their first visit." });
