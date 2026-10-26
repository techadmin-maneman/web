// What happens to clients beyond the routine, each at several points in the six months: a hold left unpaid until its
// clock runs out, moving and cancelling before and after the notice, ops moving a visit to another day for the
// client to accept, a client not home (the wait, the door, the charge, the dispute), Care's inbox and remedies, a
// grievance, a refund, a custom order, a number change, the client's data export and their erasure, and a friend
// referred by a fitted client.

import { stepHeaders, type Wire } from "../actors.ts";
import { appOf, idOf } from "./clients.ts";

export { idOf };
import { jobsToday, note, type Job } from "./field.ts";
import { catalogue, PACKAGE } from "./catalog.ts";
import { dateOf, indiaDateOf, MINUTE } from "../sim.ts";
import { check } from "../steps.ts";
import { TURNSTILE } from "../stack.ts";
import { mobileFor, type Client, type Sim, type Visit } from "../world.ts";

interface Hold {
  id: string;
  state: string;
  starts_at: string;
  expires_at: string;
  visit_id: string | null;
  price: { amount: number };
}

const live = (sim: Sim) => sim.world.clients.filter((client) => !client.erased && client.wire !== undefined);

/** A client's visit still to come, of a kind, more or less than `hours` away. */
function upcoming(
  sim: Sim,
  client: Client,
  type: Visit["type"],
  beyondHours: number | null,
  withinHours?: number,
): Visit | undefined {
  return client.visits
    .map((id) => sim.world.visits.get(id))
    .find((visit): visit is Visit => {
      if (visit?.type !== type || visit.status !== "booked") return false;
      const hours = (Date.parse(visit.startsAt) - sim.clock.now) / 3_600_000;
      return (
        hours > 0 && (beyondHours === null || hours > beyondHours) && (withinHours === undefined || hours < withinHours)
      );
    });
}

/**
 * A hold left unpaid: its clock runs out, the half-hour pass lets it go, and the start it held is open again.
 * `rivals` others hold beside it, so the release is checked under load.
 */
export async function holdExpiry(sim: Sim, wave: string, rivals: number): Promise<void> {
  const fitted = live(sim)
    .filter((client) => client.fitted)
    .slice(0, rivals + 1);
  const [first] = fitted;
  if (first === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Hold clock expiry",
      app: "app",
      screen: "/book › Pay",
      action: `${String(fitted.length)} holds left unpaid until their clocks run out`,
      mode: "api",
    },
    async () => {
      const held: { wire: Wire; hold: Hold }[] = [];
      for (const client of fitted) {
        const wire = await appOf(sim, client);
        if (wire === undefined) continue;
        const open = await wire.must<{ days: { starts: { starts_at: string; open: boolean }[] }[] }>(
          "GET",
          `/api/availability?type=service&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 2)}`,
        );
        const start = open.days.flatMap((day) => day.starts.filter((each) => each.open))[held.length];
        if (start === undefined) continue;
        const hold = await wire.must<Hold>("POST", "/api/holds", {
          type: "service",
          tier: PACKAGE,
          date: indiaDateOf(Date.parse(start.starts_at)),
          starts_at: start.starts_at,
        });
        held.push({ wire, hold });
      }
      check(held.length > 0, "no hold was made");
      const [mine] = held;
      if (mine === undefined) return;
      // Past the latest clock, then the pass that lets lapsed holds go (unbooked_holds, at :03 of each five).
      const latest = Math.max(...held.map(({ hold }) => Date.parse(hold.expires_at)));
      await sim.clock.advanceTo(latest + 2 * MINUTE);
      await sim.clock.tick(3);
      for (const { wire, hold } of held) {
        const read = await wire.must<Hold>("GET", `/api/holds/${hold.id}`);
        check(
          read.state === "expired" || read.state === "released",
          `a hold read ${read.state} two minutes past its clock`,
        );
      }
      const again = await mine.wire.must<{ days: { starts: { starts_at: string; open: boolean }[] }[] }>(
        "GET",
        `/api/availability?type=service&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 2)}`,
      );
      const start = again.days.flatMap((day) => day.starts).find((each) => each.starts_at === mine.hold.starts_at);
      check(start?.open === true, `the start ${mine.hold.starts_at} is not open again after its hold lapsed`);
    },
  );
}

/** A client moves a service visit well inside the free notice, and cancels another inside it. */
export async function moveAndCancel(sim: Sim, wave: string): Promise<void> {
  for (const client of live(sim)) {
    const visit = upcoming(sim, client, "service", 72);
    if (visit === undefined) continue;
    const wire = client.wire;
    if (wire === undefined) continue;
    await sim.steps.run(
      {
        wave,
        workflow: "Reschedule (free notice)",
        app: "app",
        screen: "/visits › Change",
        action: `${client.name} moves a visit ${String(Math.round((Date.parse(visit.startsAt) - sim.clock.now) / 3_600_000))} h out`,
        mode: "api",
      },
      async () => {
        const terms = await wire.must<{ notice: string; cost: string }>(
          "GET",
          `/api/appointments/${visit.id}/reschedule`,
        );
        check(
          terms.notice === "free" && terms.cost === "free",
          `a move ${String(72)}+ h out reads ${terms.notice}/${terms.cost}`,
        );
        const open = await wire.must<{ days: { starts: { starts_at: string; open: boolean }[] }[] }>(
          "GET",
          `/api/availability?type=service&tier=${PACKAGE}&from=${dateOf(sim.clock.day + 5)}&moving=${visit.id}`,
        );
        const start = open.days.flatMap((day) => day.starts.filter((each) => each.open))[0];
        check(start !== undefined, "nowhere to move to");
        if (start === undefined) return;
        const hold = await wire.must<Hold>("POST", "/api/holds", {
          type: "service",
          tier: PACKAGE,
          date: indiaDateOf(Date.parse(start.starts_at)),
          starts_at: start.starts_at,
          moving: visit.id,
        });
        const moved = await wire.must<{ checkout: unknown }>("POST", `/api/appointments/${visit.id}/reschedule`, {
          hold_id: hold.id,
        });
        check(moved.checkout === null, "a free move asked for a payment");
        const read = await wire.must<{ upcoming: { id: string; starts_at: string }[] }>("GET", "/api/visits");
        check(
          read.upcoming.some((each) => each.starts_at === start.starts_at),
          "the moved visit is not at its new start",
        );
        visit.status = "moved";
      },
    );
    break;
  }
  for (const client of live(sim)) {
    const visit = upcoming(sim, client, "service", null, 20);
    const wire = client.wire;
    if (visit === undefined || wire === undefined) continue;
    await sim.steps.run(
      {
        wave,
        workflow: "Cancel (inside the notice)",
        app: "app",
        screen: "/visits › Change",
        action: `${client.name} cancels a visit ${String(Math.round((Date.parse(visit.startsAt) - sim.clock.now) / 3_600_000))} h out`,
        mode: "api",
      },
      async () => {
        const terms = await wire.must<{ notice: string; refund: number; kept: number; paid: number }>(
          "POST",
          `/api/appointments/${visit.id}/cancel`,
          { confirm: false },
        );
        check(terms.notice === "late", `a cancel under 20 h out reads ${terms.notice}`);
        const done = await wire.must<{ cancelled: boolean; refund: number; kept: number }>(
          "POST",
          `/api/appointments/${visit.id}/cancel`,
          { confirm: true, notice: "late" },
        );
        check(done.cancelled, "the visit was not cancelled");
        check(
          done.refund + done.kept === terms.paid,
          `refund ${String(done.refund)} and kept ${String(done.kept)} do not add up to the ${String(terms.paid)} paid`,
        );
        sim.world.ledger.refunded += done.refund;
        visit.status = "cancelled";
      },
    );
    break;
  }
}

/** Ops ask a client to move to another day; the app shows the proposal and the client accepts it. */
export async function proposedMove(sim: Sim, wave: string): Promise<void> {
  for (const client of live(sim)) {
    const visit = upcoming(sim, client, "service", 48);
    const wire = client.wire;
    if (visit === undefined || wire === undefined || visit.technician === undefined) continue;
    await sim.steps.run(
      {
        wave,
        workflow: "Ops move → proposed move",
        app: "ops",
        screen: "/dispatch › Move → app Home",
        action: `ops propose moving ${client.name}'s visit a day later`,
        mode: "api",
      },
      async () => {
        const to = new Date(Date.parse(visit.startsAt) + 24 * 3_600_000).toISOString();
        const proposed = await sim.ops.call("POST", "/api/dispatch/propose", {
          appointment_id: visit.id,
          date: indiaDateOf(Date.parse(to)),
          starts_at: to,
          reason: "technician_unavailable",
          expected_technician_id: visit.technician ?? null,
          expected_starts_at: visit.startsAt,
        });
        check(
          proposed.status < 300,
          `the proposal answered ${String(proposed.status)}: ${JSON.stringify(proposed.body).slice(0, 200)}`,
        );
        if (proposed.status >= 300) return;
        const accepted = await wire.must<{ moved: boolean }>("POST", `/api/visits/${visit.id}/proposed-move/accept`);
        check(accepted.moved, "the move was not accepted");
      },
    );
    return;
  }
}

/** A double booking refused: moving a job onto a time its technician already works. */
export async function doubleBooking(sim: Sim, wave: string): Promise<void> {
  const booked = [...sim.world.visits.values()].filter(
    (visit) =>
      visit.status === "booked" &&
      visit.technician !== undefined &&
      Date.parse(visit.startsAt) > sim.clock.now + 48 * 3_600_000,
  );
  const pair = booked.flatMap((one) =>
    booked.filter((two) => two.id !== one.id && two.technician !== one.technician).map((two) => [one, two] as const),
  )[0];
  if (pair === undefined) return;
  const [one, two] = pair;
  await sim.steps.run(
    {
      wave,
      workflow: "Dispatch: clash refused",
      app: "ops",
      screen: "/dispatch › Move",
      action: "a job moved onto another's time with that technician",
      mode: "api",
      allow: [409, 422],
    },
    async () => {
      const answer = await sim.ops.call<{ error?: { code: string } }>("POST", "/api/dispatch/move", {
        appointment_id: one.id,
        technician_id: two.technician,
        date: indiaDateOf(Date.parse(two.startsAt)),
        starts_at: two.startsAt,
        reason: "zone_rebalance",
        expected_technician_id: one.technician ?? null,
        expected_starts_at: one.startsAt,
      });
      check(
        answer.status === 409 || answer.status === 422,
        `a move onto a technician's booked time answered ${String(answer.status)}`,
      );
    },
  );
}

/**
 * A client not home: the technician checks in, the wait runs out on the sim's clock, they close it as a no-show
 * with a note from the door; ops charge it, the client disputes the charge, ops rule.
 */
export async function noShow(sim: Sim, wave: string, ruling: "refunded" | "upheld"): Promise<void> {
  const date = indiaDateOf(sim.clock.now);
  for (const technician of sim.world.technicians.filter((each) => each.active && each.wire !== undefined)) {
    const jobs = (await jobsToday(technician, date)).filter(
      (job) => job.type === "service" && Date.parse(job.starts_at) > sim.clock.now,
    );
    const job: Job | undefined = jobs[0];
    const wire = technician.wire;
    if (job === undefined || wire === undefined) continue;
    const client = sim.world.clients.find((each) => each.name === job.client_name);
    await sim.steps.run(
      {
        wave,
        workflow: "No-show (not home)",
        app: "tech",
        screen: `/jobs/${job.id} › Not home`,
        action: `${technician.name} waits at ${job.client_name ?? "?"}'s door, closes it a no-show`,
        mode: "api",
      },
      async () => {
        await sim.clock.advanceTo(Date.parse(job.starts_at));
        const checkin = await wire.must<{ wait_ends_at: string | null }>(
          "POST",
          `/api/tech/jobs/${job.id}/checkin`,
          { lat: 28.4598, lng: 77.0268, accuracy_m: 10 },
          stepHeaders(job.starts_at),
        );
        check(checkin.wait_ends_at !== null, "the check-in gave no wait");
        const early = await wire.call(
          "POST",
          `/api/tech/jobs/${job.id}/no-show`,
          { note: "Rang twice, no answer" },
          stepHeaders(job.starts_at),
        );
        check(early.status >= 400, `a no-show before the wait ran out answered ${String(early.status)}`);
        await sim.clock.advanceTo(Date.parse(checkin.wait_ends_at ?? job.starts_at) + MINUTE);
        const closed = await wire.must<{ closed: boolean; case_id: string | null }>(
          "POST",
          `/api/tech/jobs/${job.id}/no-show`,
          { note: "Rang twice, called twice, gate locked" },
          stepHeaders(job.starts_at),
        );
        check(closed.closed && closed.case_id !== null, "the no-show did not close the job or open a case");
        note(sim, job, client, "no_show", technician);
        const cases = await sim.ops.must<{ cases: { id: string; appointment_id: string; door_note: string | null }[] }>(
          "GET",
          "/api/no-shows",
        );
        const opened = cases.cases.find((each) => each.appointment_id === job.id);
        check(opened?.door_note !== null, "the case does not carry the door's note");
        if (opened === undefined) return;
        await sim.ops.must("POST", `/api/no-shows/${opened.id}/decision`, {
          decision: "charged",
          reason: "Waited the full time; called twice",
        });
        const app = client === undefined ? undefined : await appOf(sim, client);
        if (app === undefined) return;
        await app.must("POST", `/api/visits/${job.id}/dispute`, { reason: "I was home, the bell does not work" });
        const disputes = await sim.ops.must<{ disputes?: { id: string; appointment_id?: string }[] }>(
          "GET",
          "/api/no-shows/disputes",
        );
        const dispute = (disputes.disputes ?? [])[0];
        check(dispute !== undefined, "the dispute is not listed for ops");
        if (dispute === undefined) return;
        await sim.ops.must("POST", `/api/no-shows/disputes/${dispute.id}/ruling`, {
          ruling,
          reason: ruling === "refunded" ? "Bell fault confirmed" : "Door photo shows the gate locked",
        });
      },
    );
    return;
  }
}

/** Care: a client tells of a problem, writes to our number, Care replies and grants a free service visit. */
export async function care(sim: Sim, wave: string): Promise<void> {
  const client = live(sim).find((each) => each.fitted);
  const wire = client?.wire;
  if (client === undefined || wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Care: problem, chat, remedy",
      app: "ops",
      screen: "/messages, /tasks",
      action: `${client.name}: a problem with the system, a chat answered, a free visit`,
      mode: "api",
    },
    async () => {
      await wire.must("POST", "/api/me/problems", {
        about: "hair_system",
        visit_id: null,
        text: "The front edge is lifting after three days",
      });
      const inbound = await sim.site.call("POST", "/api/dev/messages", {
        mobile: `+91${client.mobile}`,
        text: "Hi, the front is lifting, can someone help?",
      });
      check(inbound.status === 204, `the message was not taken (${String(inbound.status)})`);
      const threads = await sim.ops.must<{ conversations: { id: string; person?: { name: string } | null }[] }>(
        "GET",
        "/api/conversations",
      );
      const thread =
        threads.conversations.find((each) => each.person?.name === client.name) ?? threads.conversations[0];
      check(thread !== undefined, "no chat in Messages");
      if (thread === undefined) return;
      await sim.ops.must("POST", `/api/conversations/${thread.id}/replies`, {
        text: "Sorry about that. We will book a free service visit for you.",
      });
      const id = client.id ?? (await idOf(sim, client));
      if (id === undefined) return;
      const remedy = await sim.ops.call<{ id: string; state: string }>("POST", `/api/clients/${id}/remedies`, {
        visits: 1,
        reason: "fit_problem",
        note: "Front edge lifting three days after a service",
      });
      check(
        remedy.status < 300,
        `the remedy answered ${String(remedy.status)}: ${JSON.stringify(remedy.body).slice(0, 200)}`,
      );
      // A second remedy inside the limit's period waits for a manager, who approves it.
      if (remedy.status < 300 && remedy.body.state === "awaiting")
        await sim.ops.must("POST", `/api/remedies/${remedy.body.id}/approve`);
      await sim.ops.must("POST", `/api/conversations/${thread.id}/close`, { reason: "fit_problem" });
      const refer = await wire.must<{ credits: { visits: number } }>("GET", "/api/refer");
      check(refer.credits.visits >= 1, "the free visit is not among the client's credits");
    },
  );
}

/** A grievance about the client's data, answered by ops; and a payment made twice, refunded once. */
export async function grievanceAndRefund(sim: Sim, wave: string): Promise<void> {
  const client = live(sim).find((each) => each.fitted);
  const wire = client?.wire;
  if (client === undefined || wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Grievance",
      app: "app",
      screen: "/profile › Grievance → /grievances",
      action: `${client.name} raises a grievance; ops answer it`,
      mode: "api",
    },
    async () => {
      const raised = await wire.must<{ id: string }>("POST", "/api/grievances", {
        text: "Why does a technician see my address the evening before?",
      });
      await sim.ops.must("POST", `/api/grievances/${raised.id}/resolve`, {
        response: "Only the technician on the visit sees it, from 6 pm the evening before.",
      });
      const profile = await wire.must<{ grievances: { id: string; state: string }[] }>("GET", "/api/profile");
      check(
        profile.grievances.find((each) => each.id === raised.id)?.state === "resolved",
        "the client's profile does not read the answer",
      );
    },
  );
  await sim.steps.run(
    {
      wave,
      workflow: "Refund",
      app: "ops",
      screen: "/ledger › Refund",
      action: "a payment refunded once, a second try refused",
      mode: "api",
      allow: [409, 422],
    },
    async () => {
      const ledger = await sim.ops.must<{
        payments: { id: string; amount: number; refunded_amount: number; status: string }[];
      }>("GET", `/api/payments/ledger?from=${dateOf(Math.max(1, sim.clock.day - 20))}&to=${dateOf(sim.clock.day)}`);
      const payment = ledger.payments.find(
        (each) => each.refunded_amount === 0 && each.amount > 0 && each.status === "captured",
      );
      check(payment !== undefined, "no captured payment to refund");
      if (payment === undefined) return;
      await sim.ops.must("POST", `/api/payments/${payment.id}/refund`, { reason: "Paid twice through the app" });
      sim.world.ledger.refunded += payment.amount;
      const again = await sim.ops.call("POST", `/api/payments/${payment.id}/refund`, {
        reason: "Paid twice through the app",
      });
      check(again.status >= 400, `a second refund of the same payment answered ${String(again.status)}`);
    },
  );
}

/** A client whose profile matches no stock code: a custom order raised to it, its link paid. */
export async function customOrder(sim: Sim, wave: string): Promise<void> {
  const client = live(sim).find(
    (each, index) => index % 9 === 8 && each.goingAhead === true && !each.fitted && each.customOrder !== true,
  );
  if (client === undefined || catalogue.supplier === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Custom order",
      app: "ops",
      screen: "/clients › Custom order → app Home",
      action: `${client.name}: a custom order to their profile`,
      mode: "api",
    },
    async () => {
      const id = client.id ?? (await idOf(sim, client));
      check(id !== undefined, "the client is not found");
      if (id === undefined) return;
      await sim.ops.must("GET", `/api/clients/${id}/stock-match`);
      const raised = await sim.ops.must<{ orders?: { id: string; state: string }[] }>(
        "POST",
        `/api/clients/${id}/custom-orders`,
        {
          supplier_id: catalogue.supplier,
          supplier_price: 1_100_000,
          amount: 3_400_000,
          promised_on: dateOf(sim.clock.day + 45),
          wave: "straight",
          note: "Colour 4, 30% grey, 80% density",
        },
      );
      client.customOrder = true;
      const wire = await appOf(sim, client);
      if (wire !== undefined) {
        const mine = await wire.must<{ orders?: unknown[]; custom_orders?: unknown[] }>("GET", "/api/me/custom-orders");
        check((mine.orders ?? mine.custom_orders ?? []).length > 0, "the client's app shows no custom order");
      }
      sim.world.notes.push(`custom order for ${client.name}: ${JSON.stringify(raised).slice(0, 120)}`);
    },
  );
}

/** A client changes their number: codes to both numbers, ops confirm, and the new number signs in. */
export async function numberChange(sim: Sim, wave: string): Promise<void> {
  const client = live(sim).find((each) => each.fitted && each.numberChanged !== true);
  const wire = client?.wire;
  if (client === undefined || wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Number change",
      app: "app",
      screen: "/profile › Number → /number-changes",
      action: `${client.name} moves to a new number; ops confirm`,
      mode: "api",
    },
    async () => {
      const next = mobileFor("9");
      const started = await wire.must<{ request_id: string }>("POST", "/api/number-change", { new_mobile: next });
      for (const number of ["old", "new"] as const) {
        await wire.must("POST", "/api/number-change/verify", {
          request_id: started.request_id,
          number,
          code: "246810",
        });
      }
      const waiting = await sim.ops.must<{ changes: { id: string; new_mobile: string }[] }>(
        "GET",
        "/api/number-changes",
      );
      const change = waiting.changes.find((each) => each.new_mobile.endsWith(next.slice(-4)));
      check(change !== undefined, "the change is not waiting for ops");
      if (change === undefined) return;
      await sim.ops.must("POST", `/api/number-changes/${change.id}/decision`, { decision: "confirm", reason: null });
      client.numberChanged = true;
      client.mobile = next;
      client.wire = undefined;
      check((await appOf(sim, client)) !== undefined, "the new number does not sign in");
    },
  );
}

/** The client's export, then a deletion asked for, decided by ops, and what is left read back as erased. */
export async function exportAndErase(sim: Sim, wave: string): Promise<void> {
  // Someone whose consultation did not go ahead, signed in to the app for the first time to ask.
  const client = sim.world.clients.find((each) => !each.erased && !each.fitted && each.goingAhead === false);
  const wire = client === undefined ? undefined : await appOf(sim, client);
  if (client === undefined || wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Data export",
      app: "app",
      screen: "/profile › My data",
      action: `${client.name} downloads everything held`,
      mode: "api",
    },
    async () => {
      const held = await wire.must("GET", "/api/me/export");
      check(Object.keys(held).length > 0, "the export is empty");
    },
  );
  await sim.steps.run(
    {
      wave,
      workflow: "Deletion → erasure",
      app: "ops",
      screen: "/deletion-requests → /clients",
      action: `${client.name} asks to be deleted; ops delete; the record reads erased`,
      mode: "api",
    },
    async () => {
      await wire.must("POST", "/api/deletion-request");
      const waiting = await sim.ops.must<{ requests: { id: string; name: string; settle_first: string | null }[] }>(
        "GET",
        "/api/deletion-requests",
      );
      const request = waiting.requests.find((each) => each.name === client.name);
      check(request !== undefined, "the request is not waiting for ops");
      if (request === undefined) return;
      await sim.ops.must("POST", `/api/deletion-requests/${request.id}/decision`, { decision: "delete", reason: null });
      client.erased = true;
      const found = await sim.ops.must<{ clients: { name: string }[] }>("POST", "/api/clients/find", {
        text: client.mobile.slice(-6),
      });
      check(
        !found.clients.some((each) => each.name === client.name),
        "the erased client is still found by name and number",
      );
      const signIn = await wire.call("GET", "/api/me");
      check(
        signIn.status === 401 || signIn.status === 403,
        `the erased client's session still answers ${String(signIn.status)}`,
      );
    },
  );
}

/** A fitted client's friend books through their invite; once fitted, the referrer is granted their reward. */
export async function referFriend(sim: Sim, wave: string): Promise<void> {
  const referrer = live(sim).find((each) => each.fitted && each.referred !== true);
  const wire = referrer?.wire;
  if (referrer === undefined || wire === undefined) return;
  await sim.steps.run(
    {
      wave,
      workflow: "Referral",
      app: "app",
      screen: "/refer → site /r/:code",
      action: `${referrer.name}'s friend books through the invite`,
      mode: "api",
    },
    async () => {
      const refer = await wire.must<{ code: string }>("GET", "/api/refer");
      await sim.site.must("GET", `/api/r/${refer.code}`);
      const pincode = sim.world.cities.get(referrer.city)?.pincodes[0] ?? referrer.pincode;
      const open = await sim.site.must<{ days: { starts: { starts_at: string; open?: boolean }[] }[] }>(
        "GET",
        `/api/availability/public?pincode=${pincode}&plan=consultation`,
      );
      const start = open.days.flatMap((day) => day.starts.filter((each) => each.open !== false))[2];
      check(start !== undefined, "no start for the friend");
      if (start === undefined) return;
      const friend: Client = {
        name: `${referrer.name.split(" ")[0] ?? "A"} Rohit`,
        mobile: mobileFor("8"),
        city: referrer.city,
        pincode,
        cohort: 0,
        fitted: false,
        erased: false,
        visits: [],
      };
      const booked = await sim.site.must<{ state: string; invite: string }>(
        "POST",
        `/api/r/${refer.code}/consultation`,
        {
          name: friend.name,
          mobile: friend.mobile,
          turnstile_token: TURNSTILE,
          pincode,
          date: indiaDateOf(Date.parse(start.starts_at)),
          window: "morning",
          starts_at: start.starts_at,
          address: {
            line1: "House 7, Block A",
            line2: null,
            locality: "Sector 15",
            city: referrer.city,
            pincode,
            access_notes: null,
            flat: "7",
          },
          consent: true,
          terms: true,
        },
      );
      check(booked.invite === "valid", `the invite reads ${booked.invite}`);
      sim.world.clients.push(friend);
      referrer.referred = true;
    },
  );
}
