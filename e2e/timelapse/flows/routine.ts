// The evening's bookings, as clients make them in the app: a first fit for each consultation that went ahead, a
// service visit for each fitted client whose last visit is a month back, and a replacement once a piece is six
// months on. Nothing books for the client: each is the client's own hold, paid in Checkout.

import { appOf, bookInApp, idOf, windowOf } from "./clients.ts";
import { check } from "../steps.ts";
import { dateOf } from "../sim.ts";
import type { Client, Sim } from "../world.ts";
import { PACKAGE } from "./catalog.ts";

/** Days after a visit closed that a fitted client books their next service. */
const SERVICE_AFTER_DAYS = 26;
const REPLACE_AFTER_DAYS = 170;

export async function eveningBookings(sim: Sim, wave: string): Promise<void> {
  const day = sim.clock.day;
  for (const client of sim.world.clients) {
    if (client.erased) continue;
    const upcoming = client.visits.some((id) => {
      const visit = sim.world.visits.get(id);
      return visit?.status === "booked" && Date.parse(visit.startsAt) > sim.clock.now;
    });
    if (upcoming) continue;
    const leftPartly = client.visits.some((id) => {
      const visit = sim.world.visits.get(id);
      return visit?.type === "first_fit" && visit.status === "partial";
    });
    if (client.goingAhead === true && !client.fitted && leftPartly && client.fitAsked !== day) {
      client.fitAsked = day;
      await refitOwed(sim, wave, client);
    } else if (client.goingAhead === true && !client.fitted && client.fitAsked !== day) {
      client.fitAsked = day;
      await bookInApp(sim, wave, client, "first_fit", { tier: PACKAGE });
    } else if (client.fitted && client.lastVisitDay !== undefined) {
      const since = day - client.lastVisitDay;
      if (client.fittedOn !== undefined && day - client.fittedOn >= REPLACE_AFTER_DAYS && !client.replaced) {
        client.replaced = true;
        await bookInApp(sim, wave, client, "replacement", { tier: PACKAGE });
      } else if (since >= SERVICE_AFTER_DAYS) {
        await bookInApp(sim, wave, client, "service", { tier: PACKAGE });
      }
    }
  }
}

interface TaskRead {
  groups: { group: string; tasks: { id: string; person: { id: string } | null; visit?: { id: string } }[] }[];
}

/**
 * A fit left "Can't fit today" (ADR 0192): the client is owed the refit free, and the payment stays with it. The app
 * must not sell them another fit meanwhile; ops book the refit from its Tasks row, with nothing to pay.
 */
async function refitOwed(sim: Sim, wave: string, client: Client): Promise<void> {
  if (!client.refitAskedInApp) {
    client.refitAskedInApp = true;
    await sim.steps.run(
      {
        wave,
        workflow: "Remake owed: app",
        app: "app",
        screen: "/book (first fit)",
        action: `${client.name}'s fit was left "Can't fit today": the app sells no second one`,
        mode: "api",
        allow: [409, 422],
      },
      async () => {
        const wire = await appOf(sim, client);
        if (wire === undefined) throw new Error("the client could not sign in");
        const offered = await wire.call(
          "GET",
          `/api/availability?type=first_fit&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 1)}`,
        );
        check(
          offered.status >= 400,
          `the app offers ${client.name} a paid first fit (${String(offered.status)}) while the refit of their fit left partly done is owed free`,
        );
      },
    );
  }
  await sim.steps.run(
    {
      wave,
      workflow: "Remake owed: ops book it",
      app: "ops",
      screen: "/tasks › Partly done → Book",
      action: `ops book ${client.name}'s refit free from Tasks`,
      mode: "api",
    },
    async () => {
      const id = client.id ?? (await idOf(sim, client));
      if (id === undefined) throw new Error("the client is not found");
      const tasks = await sim.ops.must<TaskRead>("GET", "/api/tasks");
      const task = tasks.groups
        .filter((group) => group.group === "partial_visit")
        .flatMap((group) => group.tasks)
        .find((each) => each.person?.id === id);
      check(task !== undefined, `no Partly done row on Tasks for ${client.name}'s fit`);
      const covers = task?.visit?.id ?? task?.id;
      const open = await sim.ops.must<{
        owed: { id: string }[];
        days: { date: string; starts?: { starts_at: string; technicians: unknown[] }[] }[];
      }>(
        "GET",
        `/api/visits/availability?client=${id}&kind=first_fit&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 2)}`,
      );
      const day = open.days.find((each) => (each.starts ?? []).some((start) => start.technicians.length > 0));
      const start = day?.starts?.find((each) => each.technicians.length > 0);
      check(day !== undefined && start !== undefined, "no start open for the refit");
      if (day === undefined || start === undefined) return;
      const booked = await sim.ops.must<{ pays: string; visit_id: string | null; starts_at: string }>(
        "POST",
        "/api/visits",
        {
          client: id,
          kind: "first_fit",
          tier: PACKAGE,
          date: day.date,
          window: windowOf(start.starts_at),
          starts_at: start.starts_at,
          covers: open.owed[0]?.id ?? covers,
        },
      );
      check(booked.pays === "nothing", `the refit is booked to be paid (${booked.pays})`);
      if (booked.visit_id !== null) {
        client.visits.push(booked.visit_id);
        sim.world.visits.set(booked.visit_id, {
          id: booked.visit_id,
          type: "first_fit",
          client: client.name,
          startsAt: booked.starts_at,
          price: 0,
          bookedOnDay: sim.clock.day,
          status: "booked",
        });
      }
    },
  );
}
