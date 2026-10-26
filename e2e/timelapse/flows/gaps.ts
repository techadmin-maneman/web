// The rest of the brief's workflows, each at its own days: a launch scheduled a week ahead going live on its day,
// those waiting in a pincode told when it opens, ops booking a visit for a client and the link paid, a technician
// switched off and back on, and the client's sessions, address and consents.

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { fullDate } from "../../../packages/web-kit/dates.ts";
import { Phone } from "../actors.ts";
import { appOf, windowOf } from "./clients.ts";
import { idOf } from "./client-events.ts";
import { PACKAGE } from "./catalog.ts";
import { clockHeaders, dateOf, indiaDateOf, simNow } from "../sim.ts";
import { API } from "../stack.ts";
import { check } from "../steps.ts";
import { recordPaid, type Sim, type Visit } from "../world.ts";

/** The pincodes a launch scheduled a week back now read served: the cron's launch job ran on its day. */
export async function launchWentLive(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Scheduled launch",
      app: "worker",
      screen: "/settings/areas › Launches (cron: launches)",
      action: "the launches due today are live",
      mode: "api",
    },
    async () => {
      const launches = await sim.ops.must<{
        launches: { id: string; city: string; go_live_on: string; state: string; pincodes: { pincode: string }[] }[];
      }>("GET", "/api/pincode-launches");
      const due = launches.launches.filter(
        (each) => each.go_live_on <= dateOf(sim.clock.day) && each.state !== "cancelled",
      );
      check(due.length > 0, "no launch was due by today");
      const area = await sim.ops.must<{ pincodes: { pincode: string; served: boolean }[] }>("GET", "/api/service-area");
      const faults: string[] = [];
      for (const launch of due) {
        if (launch.state !== "live")
          faults.push(`${launch.city} launch for ${launch.go_live_on} reads ${launch.state}`);
        for (const { pincode } of launch.pincodes) {
          if (area.pincodes.find((each) => each.pincode === pincode)?.served !== true)
            faults.push(`${pincode} not served after its launch day`);
        }
      }
      check(faults.length === 0, faults.slice(0, 5).join("; "));
      for (const launch of due)
        sim.world.cities.get(launch.city)?.pincodes.push(...launch.pincodes.map((each) => each.pincode));
    },
  );
}

/** A pincode someone waits in, served: the save says it told them (the launch alert). */
export async function waitlistTold(sim: Sim, wave: string, pincode: string, city: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Waitlist → launch",
      app: "ops",
      screen: "/settings/areas › Waiting",
      action: `${pincode} served; those waiting told`,
      mode: "api",
    },
    async () => {
      const waiting = await sim.ops.must<{
        areas?: { pincode: string; waiting: number; to_alert?: number; held?: boolean }[];
      }>("GET", "/api/waitlist");
      const row = (waiting.areas ?? []).find((each) => each.pincode === pincode);
      check(row !== undefined && row.waiting > 0, `nobody waits in ${pincode} on the Waiting tab`);
      const held = await sim.ops.must<{ pincodes: { pincode: string }[] }>("GET", "/api/service-area");
      if (!held.pincodes.some((each) => each.pincode === pincode)) {
        await sim.ops.must("POST", "/api/pincodes", { pincode, area: `${city} central`, city });
      }
      const saved = await sim.ops.must<{ alerted: number }>("POST", "/api/service-area", {
        changes: [{ pincode, served: true, launch_on: null }],
      });
      check(saved.alerted >= 1, `serving ${pincode} told ${String(saved.alerted)} of those waiting`);
      sim.world.cities.get(city)?.pincodes.push(pincode);
    },
  );
}

/** The webhook's secret, as the local API reads it from .dev.vars. */
const secret = () => /^RAZORPAY_WEBHOOK_SECRET=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim() ?? "";

/** Ops book a service visit for a client they are talking to; the payment link it sends is paid as Razorpay pays one. */
export async function opsBooking(sim: Sim, wave: string): Promise<void> {
  const client = sim.world.clients.find(
    (each) => each.fitted && !each.erased && !each.visits.some((id) => sim.world.visits.get(id)?.status === "booked"),
  );
  if (client === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Ops booking + payment link",
      app: "ops",
      screen: "/clients › Book a visit",
      action: `ops book ${client.name}'s service; the link is paid`,
      mode: "api",
    },
    async () => {
      const id = client.id ?? (await idOf(sim, client));
      if (id === undefined) throw new Error("the client is not found");
      const open = await sim.ops.must<{
        days: {
          date: string;
          starts?: { starts_at: string; technicians: unknown[] }[];
          windows?: { window: string; open: boolean }[];
        }[];
      }>("GET", `/api/visits/availability?client=${id}&kind=service&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 2)}`);
      const day = open.days.find((each) => (each.starts ?? []).some((start) => start.technicians.length > 0));
      const start = day?.starts?.find((each) => each.technicians.length > 0);
      check(day !== undefined && start !== undefined, "nothing open to book");
      if (day === undefined || start === undefined) return;
      const booked = await sim.ops.must<{
        hold_id: string;
        outcome: string;
        visit_id: string | null;
        pays: string;
        link: { url: string } | null;
        starts_at: string;
        price: { amount: number } | null;
      }>("POST", "/api/visits", {
        client: id,
        kind: "service",
        tier: PACKAGE,
        date: day.date,
        window: windowOf(start.starts_at),
        starts_at: start.starts_at,
      });
      if (booked.pays === "link") {
        check(booked.link !== null, "a link booking carries no link");
        const linkId = booked.link?.url.split("/").filter(Boolean).at(-1) ?? "";
        const amount = booked.price?.amount ?? 0;
        const body = JSON.stringify({
          entity: "event",
          event: "payment_link.paid",
          contains: ["payment_link", "payment"],
          payload: {
            payment_link: {
              entity: { id: linkId, status: "paid", reference_id: booked.hold_id, order_id: `order_${linkId}` },
            },
            payment: {
              entity: {
                id: `pay_tl_${randomUUID().slice(0, 12)}`,
                entity: "payment",
                amount,
                currency: "INR",
                status: "captured",
                order_id: `order_${linkId}`,
                method: "upi",
                notes: { hold_id: booked.hold_id },
                created_at: Math.floor(simNow() / 1000),
              },
            },
          },
        });
        const answer = await fetch(`${API}/api/hooks/razorpay`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Razorpay-Signature": createHmac("sha256", secret()).update(body).digest("hex"),
            "X-Razorpay-Event-Id": `evt_tl_${randomUUID()}`,
            ...clockHeaders(),
          },
          body,
        });
        check(answer.ok, `the link's webhook answered ${String(answer.status)}`);
        recordPaid(sim.world, indiaDateOf(sim.clock.now).slice(0, 7), amount);
      }
      const wire = await appOf(sim, client);
      if (wire === undefined) return;
      let visits = await wire.must<{ upcoming: { id: string; starts_at: string }[] }>("GET", "/api/visits");
      for (
        let tries = 0;
        tries < 20 && !visits.upcoming.some((each) => each.starts_at === booked.starts_at);
        tries += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        visits = await wire.must<{ upcoming: { id: string; starts_at: string }[] }>("GET", "/api/visits");
      }
      const visit = visits.upcoming.find((each) => each.starts_at === booked.starts_at);
      check(visit !== undefined, `the visit ops booked (${booked.pays}, ${booked.outcome}) is not in the client's app`);
      if (visit !== undefined) {
        const record: Visit = {
          id: visit.id,
          type: "service",
          client: client.name,
          startsAt: visit.starts_at,
          price: booked.price?.amount ?? 0,
          bookedOnDay: sim.clock.day,
          status: "booked",
        };
        sim.world.visits.set(visit.id, record);
        client.visits.push(visit.id);
      }
    },
  );
}

/** A technician switched off (their visits listed, no longer theirs), then switched back on. */
export async function switchOffAndOn(sim: Sim, wave: string): Promise<void> {
  const technician = sim.world.technicians.find((each) => each.active && !each.fits && each.city === "Delhi");
  if (technician === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Technician switch",
      app: "ops",
      screen: `/technicians/${technician.id}`,
      action: `${technician.name} switched off, then on`,
      mode: "api",
    },
    async () => {
      const off = await sim.ops.must<{ released?: unknown[]; visits?: unknown[] }>(
        "POST",
        `/api/technicians/${technician.id}/deactivate`,
        { confirm: true },
      );
      technician.active = false;
      const jobs = await technician.wire?.call("GET", "/api/tech/jobs");
      check(
        jobs === undefined || jobs.status === 401 || jobs.status === 403,
        `a switched-off technician's phone still reads jobs (${String(jobs?.status)})`,
      );
      await sim.ops.must("POST", `/api/technicians/${technician.id}/reactivate`, {});
      technician.active = true;
      sim.world.notes.push(`${technician.name} switched off: ${JSON.stringify(off).slice(0, 160)}`);
    },
  );
}

/** The client's own record: an address changed, a consent switched off and on, other sessions signed out. */
export async function profileUpkeep(sim: Sim, wave: string): Promise<void> {
  const client = sim.world.clients.find((each) => each.fitted && !each.erased);
  if (client === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Profile: address, consents, sessions",
      app: "app",
      screen: "/profile",
      action: `${client.name} moves flat, switches a consent, signs out elsewhere`,
      mode: "api",
    },
    async () => {
      const wire = await appOf(sim, client);
      if (wire === undefined) throw new Error("the client could not sign in");
      const second = await appOf(sim, { ...client, wire: undefined });
      check(second !== undefined, "a second sign-in failed");
      await wire.must("PATCH", "/api/profile/address", {
        line1: "House 22, Block D",
        line2: null,
        locality: "Sector 15",
        city: client.city,
        pincode: client.pincode,
        access_notes: "Ring twice",
        flat: "22",
      });
      await wire.must("PATCH", "/api/consents/whatsapp_launches", { granted: false, source: "app_profile" });
      await wire.must("PATCH", "/api/consents/whatsapp_launches", { granted: true, source: "app_profile" });
      const sessions = await wire.must<{ sessions: { id: string; this_device: boolean }[] }>("GET", "/api/sessions");
      check(
        sessions.sessions.length >= 2,
        `the client reads ${String(sessions.sessions.length)} sessions after signing in twice`,
      );
      await wire.must("DELETE", "/api/sessions/others");
      const after = await wire.must<{ sessions: unknown[] }>("GET", "/api/sessions");
      check(after.sessions.length === 1, `${String(after.sessions.length)} sessions after signing the others out`);
      const profile = await wire.must<{ address: { line1: string } | null }>("GET", "/api/profile");
      check(profile.address?.line1 === "House 22, Block D", "the new address does not read back");
    },
  );
}

/**
 * A desk whose own clock is weeks out (the browser left on the real date, the API on the sim's): the console must
 * still say the API's today, as the client and technician apps do. The page's sub-header carries the day.
 */
export async function deskClockDrift(sim: Sim, wave: string): Promise<void> {
  const phone = await Phone.open(sim.browser, sim.clock, sim.steps, "ops", { onClock: false });
  await sim.steps.run(
    {
      wave,
      workflow: "Clock drift: console",
      app: "ops",
      screen: "/today",
      action: "a desk with a wrong clock opens Today",
      mode: "ui",
    },
    async () => {
      await phone.go("/today");
      // One answer heard, as any first page load has: the Date header the console is to set its clock by.
      await phone.page.waitForLoadState("networkidle");
      await phone.go("/today");
      const want = fullDate(indiaDateOf(sim.clock.now));
      await expect(phone.page.getByText(want).first()).toBeVisible();
    },
    { pages: [phone.page] },
  );
  await phone.close();
}
