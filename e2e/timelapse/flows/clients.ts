// Clients: found on the site each week (a lead, then a free consultation at an address in a served pincode, or the
// waitlist for one we do not serve), signed in to the app with the local code, and booking what the app offers them
// next: the first fit once the consultation went ahead, then each service as it falls due. A paid hold is paid as
// Razorpay pays it (its signed webhook), and read back booked.

import { Wire, clientSignIn, razorpayPaid } from "../actors.ts";
import { catalogue } from "./catalog.ts";
import { dateOf, indiaDateOf } from "../sim.ts";
import { check } from "../steps.ts";
import { TURNSTILE } from "../stack.ts";
import { mobileFor, recordPaid, type Client, type Sim } from "../world.ts";

const FIRST = [
  "Arjun",
  "Kabir",
  "Rohan",
  "Vikram",
  "Aditya",
  "Nikhil",
  "Rahul",
  "Karan",
  "Siddharth",
  "Varun",
  "Manish",
  "Gaurav",
];
const LAST = [
  "Mehta",
  "Anand",
  "Kapoor",
  "Sethi",
  "Malhotra",
  "Bansal",
  "Chopra",
  "Gill",
  "Arora",
  "Bhatia",
  "Khanna",
  "Suri",
];
let named = 0;
const nextName = () => {
  named += 1;
  return `${FIRST[named % FIRST.length] ?? "Arjun"} ${LAST[Math.floor(named / FIRST.length) % LAST.length] ?? "Mehta"}`;
};

interface PublicDay {
  date: string;
  starts: { starts_at: string; open?: boolean }[];
  windows: Record<string, boolean>;
}

/** A served pincode of a city, picked in turn. */
function pincodeIn(sim: Sim, index: number): { city: string; pincode: string } | null {
  const cities = [...sim.world.cities.entries()].filter(([, held]) => held.pincodes.length > 0);
  const picked = cities[index % Math.max(1, cities.length)];
  if (picked === undefined) return null;
  const [city, held] = picked;
  return { city, pincode: held.pincodes[index % held.pincodes.length] ?? held.pincodes[0] ?? "" };
}

/** New clients from the site: a lead, then a consultation at the first open start; one in four on the waitlist. */
export async function acquire(sim: Sim, wave: string, count: number, cohort: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const place = pincodeIn(sim, sim.world.clients.length + index);
    if (place === null) return;
    const name = nextName();
    const mobile = mobileFor("8");
    const client: Client = {
      name,
      mobile,
      city: place.city,
      pincode: place.pincode,
      cohort,
      fitted: false,
      erased: false,
      visits: [],
    };
    await sim.steps.run(
      {
        wave,
        workflow: "Lead → consultation",
        app: "site",
        screen: "/book",
        action: `${name} books a free consultation in ${place.pincode}`,
        mode: "api",
      },
      async () => {
        const lead = await sim.site.call("POST", "/api/lead", {
          name,
          mobile,
          consent: true,
          terms: true,
          turnstile_token: TURNSTILE,
        });
        check(lead.status === 201, `the lead answered ${String(lead.status)}`);
        const open = await sim.site.must<{ days: PublicDay[] }>(
          "GET",
          `/api/availability/public?pincode=${place.pincode}&plan=consultation`,
        );
        // The form's list is up to a minute old: a start another booking took meanwhile is refused, and the next tried.
        const starts = open.days.flatMap((day) => day.starts.filter((each) => each.open !== false)).slice(index % 3);
        let booked: { state: string } | null = null;
        for (const start of starts.slice(0, 6)) {
          const answer = await sim.site.call<{ state: string }>("POST", "/api/consultation", {
            name,
            mobile,
            pincode: place.pincode,
            turnstile_token: TURNSTILE,
            date: indiaDateOf(Date.parse(start.starts_at)),
            window: windowOf(start.starts_at),
            starts_at: start.starts_at,
            address: {
              line1: `House ${String(10 + index)}, Block C`,
              line2: null,
              locality: "Sector 14",
              city: place.city,
              pincode: place.pincode,
              access_notes: null,
              flat: String(10 + index),
            },
            consent: true,
            terms: true,
          });
          if (answer.status === 409) continue;
          check(
            answer.status === 201,
            `the consultation answered ${String(answer.status)}: ${JSON.stringify(answer.body).slice(0, 200)}`,
          );
          booked = answer.body;
          break;
        }
        check(booked !== null, `every start offered in ${place.pincode} was refused as taken`);
        if (booked === null) return;
        check(booked.state === "booked", `the consultation reads ${booked.state}`);
        sim.world.clients.push(client);
      },
    );
  }
}

/** The window a start falls in, as the form sends it beside the start: morning before noon, evening from four. */
export function windowOf(startsAt: string): "morning" | "afternoon" | "evening" {
  const hour = Number(new Date(Date.parse(startsAt) + 330 * 60_000).toISOString().slice(11, 13));
  if (hour < 12) return "morning";
  return hour < 16 ? "afternoon" : "evening";
}

/** Someone in a pincode we do not serve yet, on its list with the launch alert on. */
export async function joinWaitlist(sim: Sim, wave: string, pincode: string): Promise<void> {
  const name = nextName();
  await sim.steps.run(
    {
      wave,
      workflow: "Waitlist",
      app: "site",
      screen: "/book (unserved)",
      action: `${name} waits for ${pincode}`,
      mode: "api",
    },
    async () => {
      await sim.site.must("POST", "/api/waitlist", {
        name,
        mobile: mobileFor("7"),
        pincode,
        turnstile_token: TURNSTILE,
        contact_consent: true,
        launch_alert: true,
      });
    },
  );
}

/** The client's id, found as ops find a client: by four digits of their number. */
export async function idOf(sim: Sim, client: Client): Promise<string | undefined> {
  const found = await sim.ops.must<{ clients: { id: string; name: string }[] }>("POST", "/api/clients/find", {
    text: client.mobile.slice(-6),
  });
  client.id = found.clients.find((each) => each.name === client.name)?.id;
  return client.id;
}

/** The client's app on the wire, signed in once. */
export async function appOf(sim: Sim, client: Client): Promise<Wire | undefined> {
  if (client.wire !== undefined) return client.wire;
  const wire = new Wire("app", sim.steps);
  if (!(await clientSignIn(wire, client.mobile))) return undefined;
  client.wire = wire;
  return wire;
}

interface Hold {
  id: string;
  state: string;
  paid: boolean;
  visit_id: string | null;
  price: { amount: number };
  starts_at: string;
}

/** Books what the app offers: the first open start of `type` from `from` on, paid through Checkout and Razorpay. */
export async function bookInApp(
  sim: Sim,
  wave: string,
  client: Client,
  type: "first_fit" | "service" | "replacement",
  options: { from?: string; tier?: string; code?: string } = {},
): Promise<Hold | undefined> {
  return sim.steps.run(
    {
      wave,
      workflow: `Booking: ${type}`,
      app: "app",
      screen: "/book",
      action: `${client.name} books a ${type.replace("_", " ")}`,
      mode: "api",
    },
    async () => {
      const wire = await appOf(sim, client);
      check(wire !== undefined, `${client.name} could not sign in`);
      if (wire === undefined) return undefined;
      const tier = options.tier ?? "standard";
      const from = options.from ?? dateOf(sim.clock.day + 1);
      const open = await wire.must<{ days: { date: string; starts: { starts_at: string; open: boolean }[] }[] }>(
        "GET",
        `/api/availability?type=${type}&tier=${tier}&from=${from}`,
      );
      const starts = open.days.flatMap((day) => day.starts.filter((each) => each.open));
      check(starts.length > 0, `nothing open for a ${type} from ${from}`);
      let hold: Hold | undefined;
      for (const start of starts.slice(0, 4)) {
        const answer = await wire.call<Hold>("POST", "/api/holds", {
          type,
          tier,
          date: indiaDateOf(Date.parse(start.starts_at)),
          starts_at: start.starts_at,
        });
        if (answer.status === 409) continue;
        if (answer.status >= 400)
          throw new Error(
            `POST /api/holds answered ${String(answer.status)}: ${JSON.stringify(answer.body).slice(0, 300)}`,
          );
        hold = answer.body;
        break;
      }
      check(hold !== undefined, "four starts in a row were taken");
      if (hold === undefined) return undefined;
      if (options.code !== undefined)
        await wire.must("POST", `/api/holds/${hold.id}/discount-code`, { code: options.code });
      const booking = await wire.must<{ checkout: { order_id: string; amount: number } | null }>(
        "POST",
        "/api/bookings",
        { hold_id: hold.id, terms: true },
      );
      if (booking.checkout !== null) {
        const personId = client.id ?? (await idOf(sim, client)) ?? "";
        const status = await razorpayPaid(booking.checkout, { hold_id: hold.id, person_id: personId });
        check(status === 200, `Razorpay's webhook answered ${String(status)}`);
        recordPaid(sim.world, indiaDateOf(sim.clock.now).slice(0, 7), booking.checkout.amount);
      }
      // The webhook's event is queued: the hold reads booked once the queue has applied it, which the evening's
      // settle step waits for, all holds together.
      const read = await wire.must<Hold>("GET", `/api/holds/${hold.id}`);
      if (read.state === "booked") recordVisit(sim, client, type, read);
      else pending.push({ client, type, wire, hold: read, day: sim.clock.day });
      return read;
    },
  );
}

interface Pending {
  readonly client: Client;
  readonly type: "first_fit" | "service" | "replacement";
  readonly wire: Wire;
  readonly hold: Hold;
  readonly day: number;
}

/** Holds paid for, waiting on the queue to book them. */
const pending: Pending[] = [];

function recordVisit(sim: Sim, client: Client, type: Pending["type"], read: Hold): void {
  if (read.visit_id === null) return;
  client.visits.push(read.visit_id);
  sim.world.visits.set(read.visit_id, {
    id: read.visit_id,
    type,
    client: client.name,
    startsAt: read.starts_at,
    price: read.price.amount,
    bookedOnDay: sim.clock.day,
    status: "booked",
  });
}

/** Every paid hold of the day read again until it is booked, ten seconds at most for them all. */
export async function settleHolds(sim: Sim, wave: string): Promise<void> {
  if (pending.length === 0) return;
  const waiting = pending.splice(0);
  await sim.steps.run(
    {
      wave,
      workflow: "Payment → booking",
      app: "worker",
      screen: "Razorpay webhook → queue → hold",
      action: `${String(waiting.length)} paid holds booked`,
      mode: "api",
    },
    async () => {
      const deadline = Date.now() + 10_000;
      let left = waiting;
      while (left.length > 0 && Date.now() < deadline) {
        const still: Pending[] = [];
        for (const each of left) {
          const read = await each.wire.must<Hold>("GET", `/api/holds/${each.hold.id}`);
          if (read.state === "booked") recordVisit(sim, each.client, each.type, read);
          else if (read.state === "held") still.push(each);
          else throw new Error(`${each.client.name}'s paid ${each.type} hold reads ${read.state}`);
        }
        left = still;
        if (left.length > 0) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      check(left.length === 0, `${String(left.length)} paid holds still not booked after ten seconds`);
    },
  );
}

/** The stock codes a client's profile can match, by their index into the catalogue: most match, a few never do. */
export function stockCodeFor(clientIndex: number): string | null {
  if (clientIndex % 9 === 8) return null;
  return catalogue.hairSystems[clientIndex % catalogue.hairSystems.length] ?? null;
}
