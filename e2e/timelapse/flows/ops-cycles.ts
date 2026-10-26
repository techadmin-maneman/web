// The console's monthly and mid-month work: technician pay set up on day 1 and stated at every month end, leave asked
// on the phone and decided on Tasks, cycle counts that match, run short and run over, a recall and the quality pages,
// staff added and their grants changed, price and rule changes mid-stream (visits booked before keep what they were
// sold), closed days, window times, the site's words, discount codes and a partner's referrals.

import { expect } from "@playwright/test";
import { shell } from "../../../apps/ops/src/content/shell.ts";
import { Phone, Wire } from "../actors.ts";
import { idOf } from "./client-events.ts";
import { catalogue, PACKAGE } from "./catalog.ts";
import { dateOf, monthOf } from "../sim.ts";
import { check } from "../steps.ts";
import { remember, type Sim } from "../world.ts";

/** What each kind of visit pays a Standard-grade technician, in paise. */
export const RATES = {
  consultation: 30_000,
  one_visit: 120_000,
  first_fit: 120_000,
  service: 50_000,
  replacement: 90_000,
  no_show: 15_000,
} as const;
let gradeId: string | undefined;

export async function setUpPay(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Technician pay",
      app: "ops",
      screen: "/settings/pay-grades",
      action: "a grade, its rates per visit, every technician on it",
      mode: "api",
    },
    async () => {
      const made = await sim.ops.must<{ grades: { id: string; name: string }[] }>(
        "POST",
        "/api/technician-pay/grades",
        { name: "Standard" },
      );
      gradeId = made.grades.find((each) => each.name === "Standard")?.id;
      check(gradeId !== undefined, "the grade is not listed");
      for (const [kind, amount] of Object.entries(RATES)) {
        await sim.ops.must("POST", "/api/technician-pay/rates", {
          grade_id: gradeId,
          city: null,
          kind,
          amount,
          from: dateOf(sim.clock.day),
        });
      }
      await gradeEveryone(sim);
      await sim.desk.go("/settings/pay-grades");
      await expect(sim.desk.page.getByText("Standard").first()).toBeVisible();
    },
    { pages: [sim.desk.page] },
  );
}

/** Every technician without a grade put on Standard: new ones join each geography wave. */
export async function gradeEveryone(sim: Sim): Promise<void> {
  if (gradeId === undefined) return;
  for (const technician of sim.world.technicians.filter((each) => !each.graded)) {
    await sim.ops.must("POST", `/api/technician-pay/technicians/${technician.id}`, { grade_id: gradeId });
    technician.graded = true;
  }
}

interface StatementLine {
  technician_id: string;
  kind: string;
  visits: number;
  amount: number | null;
}

/** The month's pay statement held to the visits the run closed: each technician's count of each kind, and its sum. */
export async function payStatement(sim: Sim, wave: string, month: string): Promise<void> {
  await gradeEveryone(sim);
  await sim.steps.run(
    {
      wave,
      workflow: "Technician pay statement",
      app: "ops",
      screen: "/technician-pay",
      action: `${month}: statement against the visits closed`,
      mode: "ui+api",
    },
    async () => {
      const statement = await sim.ops.must<{ lines: StatementLine[] }>(
        "GET",
        `/api/technician-pay/statement?month=${month}`,
      );
      const expected = new Map<string, number>();
      let partialFits = 0;
      for (const visit of sim.world.visits.values()) {
        if (visit.technician === undefined || visit.closedOnDay === undefined) continue;
        if (!dateOf(visit.closedOnDay).startsWith(month)) continue;
        if (visit.status !== "done" && visit.status !== "no_show" && visit.status !== "partial") continue;
        if (visit.status === "partial") partialFits += 1;
        // A fit closed "Can't fit today" pays the consultation rate; the refit pays the fit.
        const kind = visit.status === "no_show" ? "no_show" : visit.status === "partial" ? "consultation" : visit.type;
        const key = `${visit.technician}/${kind}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      const faults: string[] = [];
      for (const [key, count] of expected) {
        const [technician, kind] = key.split("/");
        const line = statement.lines.find((each) => each.technician_id === technician && each.kind === kind);
        const name = sim.world.technicians.find((each) => each.id === technician)?.name ?? technician;
        if (line === undefined) faults.push(`${String(name)}: no ${String(kind)} line, ${String(count)} closed`);
        else {
          if (line.visits !== count)
            faults.push(
              `${String(name)}: ${String(kind)} ${String(line.visits)} on the statement, ${String(count)} closed`,
            );
          const rate = RATES[kind as keyof typeof RATES];
          if (line.amount !== line.visits * rate)
            faults.push(
              `${String(name)}: ${String(kind)} pays ${String(line.amount)} for ${String(line.visits)} at ${String(rate)}`,
            );
        }
      }
      await sim.desk.go("/technician-pay");
      await expect(sim.desk.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (partialFits > 0)
        sim.world.notes.push(
          `${month}: pay counts ${String(partialFits)} fits closed "Can't fit today" at the consultation rate`,
        );
      check(faults.length === 0, faults.slice(0, 6).join("; "));
    },
    { pages: [sim.desk.page] },
  );
}

/** A technician asks for leave on the phone, on a day they have work and on an empty one; ops decide each on Tasks. */
export async function leave(sim: Sim, wave: string): Promise<void> {
  const technician =
    sim.world.technicians.find((each) => each.active && each.wire !== undefined && !each.fits) ??
    sim.world.technicians[0];
  const wire = technician?.wire;
  if (technician === undefined || wire === undefined) return;
  for (const [offset, decision] of [
    [3, "approved"],
    [9, "declined"],
  ] as const) {
    await sim.steps.run(
      {
        wave,
        workflow: "Technician leave",
        app: "tech",
        screen: "/mine/leave → /tasks",
        action: `${technician.name} asks for ${dateOf(sim.clock.day + offset)}; ops ${decision}`,
        mode: "api",
      },
      async () => {
        const day = dateOf(sim.clock.day + offset);
        const asked = await wire.must<{ requests: { id: string; from: string; state: string }[] }>(
          "POST",
          "/api/tech/leave",
          { from: day, to: day, note: "Family function" },
        );
        const request = asked.requests.find((each) => each.from === day && each.state === "asked");
        check(request !== undefined, "the request is not listed as asked");
        if (request === undefined) return;
        const tasks = await sim.ops.must<{ groups: { group: string; tasks: { id: string }[] }[] }>("GET", "/api/tasks");
        const onTasks = tasks.groups
          .filter((group) => group.group === "leave_request" || group.group === "leave_conflict")
          .flatMap((group) => group.tasks);
        check(
          onTasks.some((task) => task.id === request.id),
          "the request is not on Tasks",
        );
        await sim.ops.must("POST", `/api/leave-requests/${request.id}/decision`, { decision });
        const after = await wire.must<{ requests: { id: string; state: string }[] }>("GET", "/api/tech/leave");
        check(
          after.requests.find((each) => each.id === request.id)?.state === decision,
          `the phone does not read ${decision}`,
        );
      },
    );
  }
}

/** A cycle count of one item at each kind of place: one counted exactly, one short, one over, then signed off. */
export async function counts(sim: Sim, wave: string): Promise<void> {
  const item = catalogue.consumables[0];
  const places = [catalogue.warehouse, ...catalogue.stockrooms.values()].filter(
    (each): each is string => each !== undefined,
  );
  if (item === undefined) return;
  const kinds = ["exact", "short", "over"] as const;
  for (const [index, place] of places.slice(0, 3).entries()) {
    const kind = kinds[index] ?? "exact";
    await sim.steps.run(
      {
        wave,
        workflow: "Cycle count",
        app: "ops",
        screen: "/counts",
        action: `${item.name} at ${place.slice(0, 8)}: counted ${kind}`,
        mode: "api",
      },
      async () => {
        const stock = await sim.ops.must<{
          holdings: { consumable_code: string; place_id: string; quantity: number }[];
        }>("GET", "/api/stock");
        const held =
          stock.holdings.find((each) => each.consumable_code === item.code && each.place_id === place)?.quantity ?? 0;
        const { task } = await sim.ops.must<{ task: { id: string; state: string } }>("POST", "/api/count-tasks", {
          place_id: place,
          consumable_code: item.code,
        });
        const counted = kind === "exact" ? held : kind === "short" ? Math.max(0, held - 3) : held + 2;
        await sim.ops.must("POST", `/api/count-tasks/${task.id}/counts`, {
          lines: [{ consumable_code: item.code, counted }],
        });
        const { task: read } = await sim.ops.must<{ task: { state: string } }>("GET", `/api/count-tasks/${task.id}`);
        if (kind !== "exact" && read.state !== "done") {
          await sim.ops
            .must("POST", `/api/count-tasks/${task.id}/recounts`, { lines: [{ consumable_code: item.code, counted }] })
            .catch(() => undefined);
          await sim.ops.must("POST", `/api/count-tasks/${task.id}/sign-off`, {
            note: kind === "short" ? "Three strips torn and binned" : "Two found in the returns box",
          });
        }
        const after = await sim.ops.must<{
          holdings: { consumable_code: string; place_id: string; quantity: number }[];
        }>("GET", "/api/stock");
        const now =
          after.holdings.find((each) => each.consumable_code === item.code && each.place_id === place)?.quantity ?? 0;
        check(now === counted, `the ledger holds ${String(now)} after a count of ${String(counted)}`);
      },
    );
  }
  await sim.steps.run(
    {
      wave,
      workflow: "Cycle count",
      app: "ops",
      screen: "/counts",
      action: "the Counts page reads the month's tasks",
      mode: "ui",
    },
    async () => {
      await sim.desk.go("/counts");
      await expect(sim.desk.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    },
    { pages: [sim.desk.page] },
  );
}

/** A lot of a hair system recalled: blocked everywhere, its wearers owed a free replacement on Tasks. */
export async function recall(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Recall",
      app: "ops",
      screen: "/quality › Recall",
      action: "recall the oldest hair-system lot",
      mode: "api",
    },
    async () => {
      const listed = await sim.ops.must<{ lots: { id: string; consumable_code: string; lot_code: string }[] }>(
        "GET",
        "/api/recalls",
      );
      const lot = listed.lots.find((each) => catalogue.hairSystems.includes(each.consumable_code));
      check(lot !== undefined, "no hair-system lot to recall");
      if (lot === undefined) return;
      await sim.ops.must("POST", "/api/recalls", { lot_id: lot.id, reason: "Supplier flagged a base adhesive fault" });
      remember(sim.world, "recalls", lot.lot_code);
      for (const path of ["/api/quality/failures", "/api/stock/expiry-risk"]) await sim.ops.must("GET", path);
      await sim.desk.go("/quality");
      await expect(sim.desk.page.getByText(lot.lot_code).first()).toBeVisible();
    },
    { pages: [sim.desk.page] },
  );
}

/** Staff added in each department, then a role switched: the Staff page lists them with their grants. */
export async function staff(sim: Sim, wave: string, round: number): Promise<void> {
  const people =
    round === 1
      ? [
          {
            email: "dispatch@maneman.example",
            grants: [{ department: "operations", level: "act", geography: "national", place: null }],
          },
          {
            email: "care@maneman.example",
            grants: [{ department: "customer_care", level: "act", geography: "national", place: null }],
          },
          {
            email: "finance@maneman.example",
            grants: [{ department: "finance", level: "manage", geography: "national", place: null }],
          },
          {
            email: "gurgaon.head@maneman.example",
            // The City head preset: Operations to run the city, Care to read its clients.
            grants: [
              { department: "operations", level: "manage", geography: "city", place: "Gurgaon" },
              { department: "customer_care", level: "view", geography: "city", place: "Gurgaon" },
            ],
          },
        ]
      : [
          {
            email: "dispatch@maneman.example",
            grants: [{ department: "operations", level: "manage", geography: "zone", place: "NCR" }],
          },
        ];
  await sim.steps.run(
    {
      wave,
      workflow: "Staff & access",
      app: "ops",
      screen: "/settings/staff",
      action: round === 1 ? "four staff in four roles" : "a dispatcher made a zone manager",
      mode: "api",
    },
    async () => {
      for (const person of people)
        await sim.ops.must("POST", "/api/staff", { email: person.email, active: true, grants: person.grants });
      const listed = await sim.ops.must<{ people: { email: string; grants: { level: string }[] }[] }>(
        "GET",
        "/api/staff",
      );
      for (const person of people) {
        const row = listed.people.find((each) => each.email === person.email);
        check(
          row?.grants[0]?.level === person.grants[0]?.level,
          `${person.email} reads ${row?.grants[0]?.level ?? "absent"}`,
        );
      }
      await sim.desk.go("/settings/staff");
      await expect(sim.desk.page.getByText(people[0]?.email ?? "").first()).toBeVisible();
    },
    { pages: [sim.desk.page] },
  );
}

/**
 * A price change mid-stream: the service visit and a hair system cost more from tomorrow. The visits already booked
 * keep what they were sold for; a booking from tomorrow pays the new price.
 */
export async function priceChange(sim: Sim, wave: string, step: number): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Price & rule change",
      app: "ops",
      screen: "/settings/services, /settings/cities",
      action: `service and hair systems up ${String(step * 5)}% from tomorrow; Gurgaon's own service price`,
      mode: "api",
    },
    async () => {
      const service = 220_000 + step * 11_000;
      await sim.ops.must("POST", "/api/prices", {
        item: "service",
        tier: PACKAGE,
        amount_ex_gst: service,
        gst_percent: 0,
        valid_from: dateOf(sim.clock.day + 1),
      });
      for (const code of catalogue.hairSystems) {
        await sim.ops.must("POST", "/api/prices", {
          item: "hair_system",
          tier: code,
          amount_ex_gst: 2_800_000 + step * 140_000,
          gst_percent: 0,
          valid_from: dateOf(sim.clock.day + 1),
        });
      }
      await sim.ops.must("POST", `/api/cities/Gurgaon/prices`, {
        item: "service",
        tier: PACKAGE,
        amount_ex_gst: service + 20_000,
        gst_percent: 0,
        valid_from: dateOf(sim.clock.day + 1),
      });
      remember(
        sim.world,
        "price_changes",
        `day ${String(sim.clock.day + 1)}: service ${String(service)}, Gurgaon ${String(service + 20_000)}`,
      );
      sim.world.priceFrom = { day: sim.clock.day + 1, service, gurgaon: service + 20_000 };
    },
  );
  await sim.steps.run(
    {
      wave,
      workflow: "Price & rule change",
      app: "ops",
      screen: "/settings/booking, /settings/closed-days, /settings/window-times",
      action: "change notice, a closed day, window times from a later day",
      mode: "api",
    },
    async () => {
      await sim.ops.must("POST", "/api/settings/change_notice_hours", { value: step === 2 ? 48 : 24 });
      const closed = dateOf(sim.clock.day + 10);
      const booked = await sim.ops
        .must<{ booked?: unknown[] }>("GET", `/api/blackouts/booked?from=${closed}&to=${closed}`)
        .catch(() => ({ booked: [] }));
      await sim.ops.must("POST", "/api/blackouts", {
        from: closed,
        to: closed,
        city: "Delhi",
        reason: "Local holiday",
      });
      remember(sim.world, "blackouts", `${closed} Delhi (${String(booked.booked?.length ?? 0)} booked then)`);
      sim.world.closedDays.push({ date: closed, city: "Delhi" });
      const slots = await sim.ops.call("POST", "/api/slot-times", {
        applies_from: dateOf(sim.clock.day + 70),
        unit_starts: ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30"],
        day_end: "21:00",
      });
      check(
        slots.status < 300,
        `window times from day ${String(sim.clock.day + 70)} answered ${String(slots.status)}: ${JSON.stringify(slots.body).slice(0, 200)}`,
      );
    },
  );
}

/** Visits booked before a price change keep their price; the first booked after it pays the new one. */
export async function pricesHeld(sim: Sim, wave: string): Promise<void> {
  const change = sim.world.priceFrom;
  if (change === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Price & rule change",
      app: "app",
      screen: "/visits",
      action: "visits sold before the change keep their price; after it, the new one",
      mode: "api",
    },
    () => {
      // A price applies by the visit's day (src/domain/money/price-lookup.ts): a visit on or after the change's day is
      // sold at the new price whenever it was booked; one before it keeps the old one, whenever it is read.
      const from = Date.parse(`${dateOf(change.day)}T00:00:00+05:30`);
      const paid = [...sim.world.visits.values()].filter((visit) => visit.type === "service" && visit.price > 0);
      const after = paid.filter((visit) => Date.parse(visit.startsAt) >= from && visit.bookedOnDay >= change.day - 1);
      const before = paid.filter((visit) => Date.parse(visit.startsAt) < from && visit.bookedOnDay < change.day);
      const faults: string[] = [];
      for (const visit of after.slice(0, 20)) {
        const client = sim.world.clients.find((each) => each.name === visit.client);
        const want = client?.city === "Gurgaon" ? change.gurgaon : change.service;
        if (visit.price !== want) {
          faults.push(
            `${visit.client} (${client?.city ?? "?"}) pays ${String(visit.price)} on ${visit.startsAt.slice(0, 10)}; the price from day ${String(change.day)} is ${String(want)}`,
          );
        }
      }
      for (const visit of before.slice(0, 20)) {
        if (visit.price === change.service || visit.price === change.gurgaon) {
          faults.push(
            `${visit.client}'s visit on ${visit.startsAt.slice(0, 10)}, before the change, reads the new price`,
          );
        }
      }
      check(after.length > 0, `no service visit booked since day ${String(change.day)} to hold to the new price`);
      check(faults.length === 0, faults.slice(0, 5).join("; "));
      return Promise.resolve();
    },
  );
}

/** Discount codes: one that works, one that expires, one used up, made in Settings and tried on a hold. */
export async function discountCodes(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Discount codes",
      app: "ops",
      screen: "/settings/discount-codes",
      action: "TLTEN (10%), TLSOON (expires in 10 days), TLONCE (one use)",
      mode: "api",
    },
    async () => {
      await sim.ops.must("POST", "/api/discount-codes", {
        code: "TLTEN",
        kind: "percent",
        value: 10,
        cap: null,
        covers: ["service"],
        expires_on: null,
        max_uses: null,
        once_per_client: true,
      });
      await sim.ops.must("POST", "/api/discount-codes", {
        code: "TLSOON",
        kind: "amount",
        value: 20_000,
        covers: ["service"],
        expires_on: dateOf(sim.clock.day + 10),
        max_uses: null,
        once_per_client: false,
      });
      await sim.ops.must("POST", "/api/discount-codes", {
        code: "TLONCE",
        kind: "amount",
        value: 30_000,
        covers: ["service", "first_fit"],
        expires_on: null,
        max_uses: 1,
        once_per_client: false,
      });
      await sim.desk.go("/settings/discount-codes");
      await expect(sim.desk.page.getByText("TLONCE").first()).toBeVisible();
    },
    { pages: [sim.desk.page] },
  );
}

/** A partner with a code of its own, whose friends book through it; its commission month by month. */
export async function partner(sim: Sim, wave: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Partner referrals",
      app: "ops",
      screen: "/settings/partners",
      action: "a salon partner with its code",
      mode: "api",
    },
    async () => {
      const made = await sim.ops.must<{ channels?: { id: string; code: string; name: string }[] }>(
        "POST",
        "/api/referral-channels",
        {
          name: "Fade Studio Salon",
          friend_visits: 1,
          valid_days: 90,
          commission: 150_000,
          discount_code: null,
        },
      );
      const channel = (made.channels ?? []).find((each) => each.name === "Fade Studio Salon");
      check(channel !== undefined, "the partner is not listed");
      if (channel !== undefined) sim.world.partnerCode = channel.code;
    },
  );
}

export async function partnerMonth(sim: Sim, wave: string, month: string): Promise<void> {
  await sim.steps.run(
    {
      wave,
      workflow: "Partner commission",
      app: "ops",
      screen: "/partner-commission",
      action: `${month}: statement and payout`,
      mode: "ui+api",
    },
    async () => {
      const read = await sim.ops.must<{
        statements: { channel_id: string; due: number; fitted: number; payout: unknown }[];
      }>("GET", `/api/partner-statements?month=${month}`);
      for (const statement of read.statements.filter((each) => each.due > 0 && each.payout === null)) {
        await sim.ops.must("POST", `/api/partner-statements/${statement.channel_id}/payouts`, {
          month,
          amount: statement.due,
          paid_on: dateOf(sim.clock.day),
          reference: `UTR${String(sim.clock.day)}X`,
        });
      }
      await sim.desk.go("/partner-commission");
      await expect(sim.desk.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      sim.world.notes.push(
        `${month} partner statements: ${read.statements.map((each) => `${String(each.fitted)} fitted, ${String(each.due)} due`).join("; ")}`,
      );
    },
    { pages: [sim.desk.page] },
  );
}

export const monthKey = (day: number): string => dateOf(day).slice(0, 7);
export const monthNumber = monthOf;

interface Probe {
  readonly as: string;
  readonly method: string;
  readonly path: string;
  readonly allowed: boolean;
}

/**
 * The Staff list enforced, then each department held to its grants: what a grant reaches answers, what it does not
 * is refused, and a city head reads only their own city's clients. Signed in as each person locally (src/http/access.ts).
 */
export async function permissions(sim: Sim, wave: string): Promise<void> {
  const gurgaon = sim.world.clients.find((each) => each.city === "Gurgaon" && !each.erased);
  const delhi = sim.world.clients.find((each) => each.city === "Delhi" && !each.erased);
  for (const client of [gurgaon, delhi]) if (client !== undefined && client.id === undefined) await idOf(sim, client);
  const probes: Probe[] = [
    { as: "care@maneman.example", method: "GET", path: "/api/conversations", allowed: true },
    { as: "care@maneman.example", method: "GET", path: "/api/purchase-orders", allowed: false },
    { as: "care@maneman.example", method: "GET", path: "/api/technician-pay", allowed: false },
    {
      as: "finance@maneman.example",
      method: "GET",
      path: `/api/payments/ledger?from=${dateOf(1)}&to=${dateOf(sim.clock.day)}`,
      allowed: true,
    },
    { as: "finance@maneman.example", method: "GET", path: "/api/dispatch", allowed: false },
    { as: "stranger@maneman.example", method: "GET", path: "/api/tasks", allowed: false },
    ...(gurgaon?.id === undefined
      ? []
      : [{ as: "gurgaon.head@maneman.example", method: "GET", path: `/api/clients/${gurgaon.id}`, allowed: true }]),
    ...(delhi?.id === undefined
      ? []
      : [{ as: "gurgaon.head@maneman.example", method: "GET", path: `/api/clients/${delhi.id}`, allowed: false }]),
  ];
  await sim.steps.run(
    {
      wave,
      workflow: "Permission boundaries",
      app: "ops",
      screen: "Staff list → every route",
      action: `${String(probes.length)} calls as four people, the list enforced`,
      mode: "api",
      allow: [403, 404],
    },
    async () => {
      await sim.ops.must("POST", "/api/staff/enforcement", { on: true });
      const faults: string[] = [];
      for (const probe of probes) {
        const answer = await new Wire("ops", sim.steps, probe.as).call(probe.method, probe.path);
        const got = answer.status < 400;
        if (got !== probe.allowed)
          faults.push(
            `${probe.as} ${probe.method} ${probe.path.split("?")[0] ?? ""}: ${String(answer.status)}, meant ${probe.allowed ? "allowed" : "refused"}`,
          );
      }
      check(faults.length === 0, faults.join("; "));
    },
  );
  const phone = await Phone.open(sim.browser, sim.clock, sim.steps, "ops", { staff: "care@maneman.example" });
  await sim.steps.run(
    {
      wave,
      workflow: "Permission boundaries",
      app: "ops",
      screen: "/purchasing as Care",
      action: "Care opens Purchasing: refused in words, no figures",
      mode: "ui",
      allow: [403],
    },
    async () => {
      await phone.go("/purchasing");
      await expect(phone.page.getByText(shell.closed)).toBeVisible();
    },
    { pages: [phone.page] },
  );
  await phone.close();
}
