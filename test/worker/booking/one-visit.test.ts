// A consultation and fit in one visit, at the visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the technician's card offers the products by name, his piece step records the one the client chose or that they
// decided against it, and closing the visit as done sends the client a Razorpay payment link, which Razorpay's
// webhook then says is paid. NOW is Monday 21 September 2026, 12 noon in India; the visit is today at 13:00. Every
// name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { createLogger } from "../../../src/log.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { ProviderError } from "../../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import type { Settings } from "../../../src/config/settings.ts";
import { captureLogs, LOCAL_CONFIG, LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import { JOB, PERSON, working, type Working } from "../job-fixtures.ts";
import {
  NATURAL,
  LINK_REFERENCE,
  TWO_WEEKS_ON,
  path,
  A_PIECE,
  oneVisit,
  toThePiece,
  closeAsDone,
  linkRow,
} from "./one-visit-fixtures.ts";

/** Staging's messaging, texting only the handsets named. */
const allowing = (...handsets: string[]): Partial<Settings> => ({
  messaging: { ...LOCAL_SETTINGS.messaging, allowlist: handsets },
});

beforeEach(async () => {
  captureLogs();
  await markDatabase();
});

/** The cron's job that asks again for a link a close could not have made, on its own. */
const linksJob = (job: Working) =>
  runCronJobs(
    CRON_JOBS.filter((cronJob) => cronJob.name === "payment_links"),
    { env, deps: job.deps, config: LOCAL_CONFIG, log: createLogger() },
  );

const visitRow = () => env.DB.prepare("SELECT type, tier, one_visit FROM appointments WHERE id = ?1").bind(JOB).first();

describe("the technician's card", () => {
  it("names the products the client may choose, never a price, and runs the first fit's steps and the profile", async () => {
    const job = await oneVisit();
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();
    expect(card).toMatchObject({
      type: "first_fit",
      one_visit: true,
      badge: "at_visit",
      // The first fit's, the client's choice first, with their hair profile once the product is fitted (ADR 0106).
      steps: ["before_photos", "piece", "checklist", "consumables", "profile", "after_photos", "outcome"],
      products: [
        { tier: "standard", name: "First fit" },
        { tier: "natural", name: "Mane Man Natural" },
      ],
      payment_link: null,
      client_choice: null,
    });
    // The consultation's checklist, then the fit's: measure and explain, then fit.
    const checklist = (card.checklist as { id: string }[]).map((item) => item.id);
    expect(checklist.slice(0, 3)).toEqual(["scalp_checked", "measurements_taken", "options_shown"]);
    expect(checklist).toContain("piece_set");
    // The consultation's alone, for a client who decides against the fit.
    const ifDeclined = (card.checklist_if_declined as { id: string }[]).map((item) => item.id);
    expect(ifDeclined).toEqual(["scalp_checked", "measurements_taken", "options_shown"]);
    expect(JSON.stringify(card)).not.toContain("4500000");
  });

  it("takes the consultation's items on the checklist step, as well as the fit's", async () => {
    const job = await oneVisit();
    await job.workTo("piece");
    await job.post(path("piece"), { ...A_PIECE, product: NATURAL.tier }, "event-piece-01");
    const answer = await job.post(path("checklist"), { done: ["measurements_taken", "piece_set"] }, "event-cl-01");
    expect(answer.status).toBe(202);
  });

  // The choice comes first, so the checklist after it knows whether anything is fitted.
  it("takes the client's choice before the checklist, and says on the card what they chose", async () => {
    const job = await oneVisit();
    await job.workTo("piece");
    const early = await job.post(path("checklist"), { done: ["scalp_checked"] }, "event-cl-early");
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "out_of_order", fields: ["piece"] } });

    await job.post(path("piece"), { declined: true }, "event-piece-01");
    expect(await (await job.get(`/api/tech/jobs/${JOB}`)).json()).toMatchObject({ client_choice: { declined: true } });
    expect((await job.post(path("checklist"), { done: ["scalp_checked"] }, "event-cl-01")).status).toBe(202);
  });

  it("calls any other first fit by its own steps, with no products and its own badge", async () => {
    const job = await working("first_fit");
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({
      one_visit: false,
      badge: "prepaid",
      products: [],
      payment_link: null,
      client_choice: null,
      checklist_if_declined: [],
    });
  });
});

describe("the piece step of a one visit", () => {
  it("records the product the client chose with the piece fitted", async () => {
    const job = await oneVisit();
    expect((await toThePiece(job, { ...A_PIECE, product: NATURAL.tier })).status).toBe(202);
    const step = await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'piece'").first<{ body: string }>();
    expect(JSON.parse(step?.body ?? "{}")).toMatchObject({ piece_code: A_PIECE.piece_code, product: NATURAL.tier });
  });

  it("refuses a product not offered on the visit's day, and a piece with none", async () => {
    const job = await oneVisit();
    await job.workTo("piece");
    for (const [body, field] of [
      [{ ...A_PIECE, product: "platinum" }, "product"],
      [A_PIECE, "product"],
      [{ ...A_PIECE, product: NATURAL.tier, failure_reason: "Torn" }, "failure_reason"],
    ] as const) {
      const answer = await job.post(path("piece"), body, `event-piece-${field}`);
      expect(answer.status).toBe(400);
      expect((await answer.json<{ error: { fields: string[] } }>()).error.fields).toContain(field);
    }
  });

  it("refuses a product, or a decision against the fit, on any other visit", async () => {
    const job = await working("first_fit");
    await job.workTo("consumables");
    await job.post(path("consumables"), { items: [] }, "event-consumables-01");
    for (const body of [{ declined: true }, { ...A_PIECE, product: "standard" }]) {
      const answer = await job.post(path("piece"), body, `event-piece-${String(Object.keys(body).length)}`);
      expect(answer.status).toBe(400);
    }
  });
});

describe("closing a one visit the client was fitted at", () => {
  it("makes it the product's visit and texts the client its payment link, once however often it lands", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    expect(await closeAsDone(job).then((answer) => answer.json())).toMatchObject({ replayed: true });

    expect(await visitRow()).toEqual({ type: "first_fit", tier: NATURAL.tier, one_visit: "fitted" });
    // The product as a hair system, and a reference a person can read, not the visit's ID.
    expect(payments.made.links).toEqual([
      {
        amount: NATURAL.amount,
        reference: LINK_REFERENCE,
        description: "Mane Man Natural hair system · fitted Mon 21 Sep",
        customer: { name: "Rohit Malhotra", contact: "+919810000001" },
        notes: { appointment_id: JOB, person_id: PERSON },
        closesAt: TWO_WEEKS_ON,
        notify: true,
      },
    ]);
    expect(await linkRow()).toMatchObject({ tier: NATURAL.tier, amount: NATURAL.amount, made: 1, paid_at: null });
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ payment_link: { url: expect.stringMatching(/^https:\/\/rzp\.io\//) as string } });
  });

  // A link took payment, and Razorpay kept reminding the client, however long it went unpaid.
  it("closes the payment link after 14 days, and the task for the money owed says so", async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    const owed = async (at: Date) =>
      (await outstandingTasks(env.DB, at, TASK_SLA_HOURS)).tasks.find((task) => task.group === "payment_owed")?.detail;

    // The task reads "<state> <paise> <link address> <product>".
    const reads = (state: string) =>
      new RegExp(`^${state} ${String(NATURAL.amount)} https://rzp\\.io/i/\\S+ Mane Man Natural$`);
    expect(await owed(new Date(TWO_WEEKS_ON.getTime() - 60_000))).toMatch(reads("sent"));
    expect(await owed(TWO_WEEKS_ON)).toMatch(reads("closed"));
  });

  // On staging a test record's made-up number, very likely a stranger's, was texted "pay Rs. 30,000".
  it("makes, but never texts, a payment link to a number off the staging allowlist", async () => {
    const logs = captureLogs();
    const payments = createStubPayments();
    const job = await oneVisit({ payments }, allowing("+919810000777"));
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);

    expect(payments.made.links).toMatchObject([{ customer: { contact: "+919810000001" }, notify: false }]);
    // Made all the same, for ops to send from the client's Payments tab.
    expect(await linkRow()).toMatchObject({ made: 1 });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "payment_link_not_texted", appointment_id: JOB }),
    );
  });

  it("texts the link on staging to a number on the allowlist", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments }, allowing("+919810000001"));
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    expect(payments.made.links).toMatchObject([{ notify: true }]);
  });

  it("is owed on the Tasks board until it is paid", async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "payment_owed")).toMatchObject([
      {
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: expect.stringMatching(
          new RegExp(`^sent ${String(NATURAL.amount)} https://rzp\\.io/i/\\S+ Mane Man Natural$`),
        ) as string,
      },
    ]);
  });

  // The phone's outbox is one queue for every job, so a close that did not land would hold the rest of the day.
  it("lands while Razorpay cannot be reached, and the cron sends the link once it can", async () => {
    const stub = createStubPayments();
    let reachable = false;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: (link) => (reachable ? stub.createPaymentLink(link) : Promise.reject(new Error("timeout"))),
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    expect(await linkRow()).toMatchObject({ made: 0, sent_at: null });
    await linksJob(job);
    expect(await linkRow()).toMatchObject({ made: 0, sent_at: null });

    reachable = true;
    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
    expect(await linkRow()).toMatchObject({ made: 1 });
    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
  });

  // Razorpay made and texted the link, and its answer never came: the next ask is refused for the same reference.
  it("keeps the link a try whose answer never came made, rather than calling it refused", async () => {
    const stub = createStubPayments();
    let answerLost = true;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: async (link) => {
        const made = await stub.createPaymentLink(link);
        if (!answerLost) return made;
        answerLost = false;
        throw new Error("The operation was aborted due to timeout");
      },
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    expect((await closeAsDone(job)).status).toBe(202);
    expect(await linkRow()).toMatchObject({ made: 0 });

    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
    expect(await linkRow()).toMatchObject({ made: 1 });
    expect(job.deps.alerts).toEqual([]);
  });

  // A link written before links had a reference may already be at Razorpay under the visit's ID: a new reference
  // would make it a second link, and the client could pay twice.
  it("asks for a link written before links had a reference under the visit's ID", async () => {
    const stub = createStubPayments();
    let reachable = false;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: (link) => (reachable ? stub.createPaymentLink(link) : Promise.reject(new Error("timeout"))),
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    await env.DB.prepare(
      "UPDATE payment_links SET reference = NULL, reference_year = NULL, reference_number = NULL",
    ).run();

    reachable = true;
    await linksJob(job);
    expect(stub.made.links.map((link) => link.reference)).toEqual([JOB]);
  });

  it("tells ops once when Razorpay refuses the link, with the visit's ID to make one by hand, and asks no more", async () => {
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      createPaymentLink: () => {
        asked += 1;
        return Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "Payment links are off"));
      },
    };
    const job = await oneVisit({ payments: refusing });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    await linksJob(job);
    expect(asked).toBe(1);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain(`reference ${JOB}`);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.find((task) => task.group === "payment_owed")?.detail).toBe(
      `refused ${String(NATURAL.amount)} - Mane Man Natural`,
    );
  });

  it("names the hair system, not its code, when the book has no price for it that day", async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await env.DB.prepare("DELETE FROM price_book WHERE item = 'first_fit' AND tier = ?1").bind(NATURAL.tier).run();

    expect((await closeAsDone(job)).status).toBe(202);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain("the client was fitted with Mane Man Natural, which the price book has no");
  });

  it("sends nothing for a visit closed partly done, which stays to be decided", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await job.post(path("outcome"), { outcome: "partial", reason: "client_stopped_it" }, "event-outcome-01");
    expect(payments.made.links).toEqual([]);
    expect(await visitRow()).toMatchObject({ one_visit: "booked" });
  });
});

describe("closing a one visit the client decided against", () => {
  it("makes it a consultation, with nothing charged or sent", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    expect((await toThePiece(job, { declined: true })).status).toBe(202);
    expect((await closeAsDone(job)).status).toBe(202);

    expect(await visitRow()).toEqual({ type: "consultation", tier: "standard", one_visit: "declined" });
    expect(payments.made.links).toEqual([]);
    expect(await linkRow()).toBeNull();
  });
});
