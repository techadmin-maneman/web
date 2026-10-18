// What ops do about field work, behind Access (src/policy/no-show.ts,
// technician-login.ts). The roster is here; the no-shows are ./no-shows.ts, the pieces tab
// ./client-pieces.ts, leave ./technician-leave.ts and a technician's phones ./technician-phones.ts.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { listCities } from "../../domain/cities/cities.ts";
import { leaveFrom } from "../../domain/dispatch/leave.ts";
import { roster, type RosterTechnician } from "../../domain/dispatch/technician-roster.ts";
import { devicesByTechnician, outOfCodesToday } from "../../domain/dispatch/technicians.ts";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";
import { reachOf, routeReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { reachesCity } from "../../policy/access.ts";
import { visitsToComeBy } from "../../domain/dispatch/unassigned.ts";
import { homesOf, weeksOf } from "../../domain/dispatch/technician-days.ts";
import { HomeSchema, WorkingDaySchema } from "../schemas/technician-days.ts";

const LeaveSchema = z
  .object({
    id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "Inclusive: a single day's leave has the same date twice." }),
    from_time: z.union([z.string(), z.null()]).openapi({ description: "Leave over part of one day: when it starts." }),
    to_time: z.union([z.string(), z.null()]).openapi({ description: "Leave over part of one day: when it ends." }),
    note: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("TechnicianLeave");

const MOBILE = z
  .union([z.string(), z.null()])
  .openapi({ description: "The number they sign in with, +91 and ten digits; null where none is recorded." });
const CITY = z
  .union([z.string(), z.null()])
  .openapi({ description: "The city they work in, which staff access by place reads; null for none." });

const FITS_TRAINED = z
  .boolean()
  .openapi({ description: "Trained to fit: only such a technician is offered or given a first fit (ADR 0119)." });

const VISITS_TO_COME = z
  .number()
  .int()
  .openapi({ description: "Their visits still to come and not begun, which switching them off leaves with nobody." });

const TechniciansSchema = z
  .object({
    technicians: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          initials: z.string(),
          zone: z.union([z.string(), z.null()]),
          city: CITY,
          mobile: MOBILE,
          fits_trained: FITS_TRAINED,
          visits_to_come: VISITS_TO_COME,
          sign_in_stopped_at: z.union([z.iso.datetime(), z.null()]).openapi({
            description:
              "When revoking a phone of theirs stopped them signing in; null while they may. Ops let them again.",
          }),
          out_of_codes: z.boolean().openapi({
            description: "Their number has had its login codes for today. Ops may give them back.",
          }),
          devices: z.array(
            z
              .object({
                device_id: z.string(),
                label: z.union([z.string(), z.null()]),
                last_seen_at: z.iso.datetime(),
                revoked_at: z.union([z.iso.datetime(), z.null()]),
                signed_in: z.boolean().openapi({
                  description:
                    "Whether the phone's last session is still live: false once they signed out, it ran out, or ops revoked it.",
                }),
              })
              .strict(),
          ),
          leave: z
            .array(LeaveSchema)
            .openapi({ description: "Leave that has not ended yet, soonest first (ADR 0062)." }),
          hours: z.array(WorkingDaySchema).openapi({
            description: "Their own week, each day they work; empty for one who works their city's hours every day.",
          }),
          home: z
            .union([HomeSchema, z.null()])
            .openapi({ description: "Where their day starts; null until ops set it." }),
        })
        .strict(),
    ),
    switched_off: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string(),
            zone: z.union([z.string(), z.null()]),
            city: CITY,
            mobile: MOBILE,
            fits_trained: FITS_TRAINED,
            visits_to_come: VISITS_TO_COME,
          })
          .strict(),
      )
      .openapi({
        description: "Technicians switched off, by name: they cannot sign in, and nothing is booked on them.",
      }),
    cities: z.array(z.string()).openapi({
      description:
        "The cities the caller may give a technician, those their Operations MANAGE reaches, in display order.",
    }),
  })
  .strict()
  .openapi("Technicians");

const techniciansRoute = opsRoute({
  method: "get",
  path: "/api/technicians",
  summary:
    "Active technicians in the caller's cities, the phones they have logged in on and their leave, and those switched off",
  responses: {
    200: { description: "The technicians", ...json(TechniciansSchema) },
  },
});

export function registerOpsField(app: App): void {
  app.openapi(techniciansRoute, async (c) => {
    // The phones and the leave are one read each for the whole roster, not one per technician.
    const [roll, devices, leave, cities, reach, managed, toCome, weeks, homes] = await Promise.all([
      roster(c.env.DB),
      devicesByTechnician(c.env.DB, c.var.deps.now()),
      leaveFrom(c.env.DB, indiaDate(c.var.deps.now())),
      listCities(c.env.DB),
      routeReach(c),
      reachOf(c, "operations", "manage"),
      visitsToComeBy(c.env.DB, c.var.deps.now()),
      weeksOf(c.env.DB),
      homesOf(c.env.DB),
    ]);
    const everyone = roll.filter((technician) => reachesCity(reach, technician.city));
    const { settings } = c.var.config;
    const outOfCodes = await outOfCodesToday(c.env.DB, everyone, {
      count: { salt: settings.ipHashSalt, settings },
      now: c.var.deps.now(),
    });
    const given = cities.map((city) => city.name).filter((city) => reachesCity(managed, city));
    const summaryOf = (technician: RosterTechnician) => ({
      id: technician.id,
      name: technician.name,
      zone: technician.zone,
      city: technician.city,
      mobile: technician.mobile,
      fits_trained: technician.fitsTrained,
      visits_to_come: toCome.get(technician.id) ?? 0,
    });
    const homeOf = (id: string) => {
      const home = homes.get(id);
      return home === undefined ? null : { label: home.label };
    };
    const technicians = everyone
      .filter((technician) => technician.active)
      .map((technician) => ({
        ...summaryOf(technician),
        initials: technician.initials,
        sign_in_stopped_at: technician.signInStoppedAt,
        out_of_codes: outOfCodes.has(technician.id),
        devices: devices.get(technician.id) ?? [],
        leave: leave
          .filter((period) => period.technician_id === technician.id)
          .map(({ id, from, to, from_time, to_time, note }) => ({ id, from, to, from_time, to_time, note })),
        hours: weeks.get(technician.id) ?? [],
        home: homeOf(technician.id),
      }));
    const switchedOff = everyone.filter((technician) => !technician.active).map(summaryOf);
    return c.json({ technicians, switched_off: switchedOff, cities: given }, 200);
  });
}
