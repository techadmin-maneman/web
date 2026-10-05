// The times of a working day's half-slots, behind Access (docs/decisions/0102-window-times.md):
//   GET  /api/slot-times   the times in force today, every change set, and the earliest day a change may apply from
//   POST /api/slot-times   a change of times from a day nothing is booked or bookable on
//
// A change is kept for good under the member of staff who made it, audited in the same batch (ADR 0031). Which
// half-slots each window has stays in code; the windows are read from the times.

import { createRoute, z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS, UNITS_PER_DAY } from "../config/scheduling.ts";
import { earliestChange, loadSlotSchedule, setSlotTimes } from "../domain/slot-times.ts";
import { actorOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { json } from "../http/openapi.ts";
import { indiaDate } from "../lib/india-time.ts";
import { windowTimesOf, type SlotTimes } from "../policy/slot-times.ts";

const Time = z
  .string()
  .regex(/^\d\d:\d\d$/)
  .openapi({ description: "In India's time, as 09:00." });

const TimesFields = {
  unit_starts: z
    .array(Time)
    .length(UNITS_PER_DAY)
    .openapi({ description: "When each of the day's eight half-slots starts, in order." }),
  day_end: Time.openapi({ description: "When the day, and the evening with it, ends." }),
};

const Span = z.object({ start: Time, end: Time }).strict();
const WindowsSchema = z
  .object(
    Object.fromEntries(BOOKING_WINDOWS.map((window) => [window, Span])) as Record<
      (typeof BOOKING_WINDOWS)[number],
      typeof Span
    >,
  )
  .strict()
  .openapi("WindowTimes", { description: "Each window's span, read from the half-slots it has." });

const ChangeSchema = z
  .object({
    applies_from: z.iso.date(),
    ...TimesFields,
    set_by: z.string().openapi({ description: "The member of staff's Access e-mail." }),
    set_at: z.iso.datetime(),
  })
  .strict()
  .openapi("SlotTimesChange");

const SlotTimesSchema = z
  .object({
    in_force: z
      .object({
        applies_from: z.union([z.iso.date(), z.null()]).openapi({ description: "Null for the times in code." }),
        ...TimesFields,
        windows: WindowsSchema,
      })
      .strict(),
    changes: z.array(ChangeSchema).openapi({ description: "Every change set, the earliest first; none are removed." }),
    earliest: z.iso.date().openapi({
      description:
        "The first day a change may apply from: after the last a client can book, the last visit booked and the last change.",
    }),
  })
  .strict()
  .openapi("SlotTimes");

const slotTimesRoute = createRoute({
  method: "get",
  path: "/api/slot-times",
  summary: "The day's half-slot times in force, every change set, and the earliest a change may apply from",
  responses: {
    200: { description: "The times", ...json(SlotTimesSchema) },
    403: errorResponse("access_required"),
  },
});

const setSlotTimesRoute = createRoute({
  method: "post",
  path: "/api/slot-times",
  summary: "A change of the day's half-slot times, from a day nothing is booked or bookable on",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ applies_from: z.iso.date(), ...TimesFields })
          .strict()
          .openapi("SlotTimesSet"),
      ),
    },
  },
  responses: {
    201: { description: "Set, from its day", ...json(z.object({ applies_from: z.iso.date() }).strict()) },
    400: errorResponse(
      "invalid_request: fields names what is wrong with the times: not_eight_starts, not_a_time, not_in_order, " +
        "half_slot_too_short (under 45 minutes, the last one to the day's end included) or outside_the_day " +
        "(06:00 to 22:00)",
    ),
    403: errorResponse("access_required"),
    409: errorResponse("slot_times_too_soon: the day is before the earliest a change may apply from, which GET says"),
  },
});

const fieldsOf = (times: SlotTimes) => ({ unit_starts: [...times.unitStarts], day_end: times.dayEnd });

export function registerOpsSlotTimes(app: App): void {
  app.openapi(slotTimesRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const schedule = await loadSlotSchedule(c.env.DB);
    const inForce = schedule.on(today);
    const change = schedule.changes.findLast((each) => each.appliesFrom <= today) ?? null;
    return c.json(
      {
        in_force: { applies_from: change?.appliesFrom ?? null, ...fieldsOf(inForce), windows: windowTimesOf(inForce) },
        changes: schedule.changes.map((each) => ({
          applies_from: each.appliesFrom,
          ...fieldsOf(each),
          set_by: each.setBy,
          set_at: each.setAt,
        })),
        earliest: await earliestChange(c.env.DB, now, (await opsInputs(c)).nextVisitDays.horizon),
      },
      200,
    );
  });

  app.openapi(setSlotTimesRoute, async (c) => {
    const body = c.req.valid("json");
    const staff = actorOf(c);
    const set = await setSlotTimes(c.env.DB, {
      times: { unitStarts: body.unit_starts, dayEnd: body.day_end },
      appliesFrom: body.applies_from,
      staff: staff.id,
      now: c.var.deps.now(),
      horizonDays: (await opsInputs(c)).nextVisitDays.horizon,
      audit: {
        surface: "ops",
        actor: staff,
        action: "slot_times.set",
        requestId: c.var.requestId,
        detail: { applies_from: body.applies_from },
      },
    });
    if (set.kind === "invalid") return refuse(c, "invalid_request", set.problems);
    if (set.kind === "too_soon") return refuse(c, "slot_times_too_soon");
    return c.json({ applies_from: set.appliesFrom }, 201);
  });
}
