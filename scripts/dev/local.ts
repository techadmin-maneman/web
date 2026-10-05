// What stands in, locally, for the things that happen elsewhere on staging, so
// the whole story of a visit can be run on a laptop (docs/getting-started.md).
// Each works against the stack npm run dev:all starts.
//
//   npm run tick                              every cron job at once; staging runs a few each minute
//   npm run pay:local [-- <hold-id>]          Razorpay's signed webhook for the last booking held, as if paid by UPI
//   npm run close:local [-- <visit-id> [--partial]]   a technician closing a visit; alone, lists them

import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { d1Query } from "../lib/d1.ts";
import { API_ORIGIN } from "../lib/local-stack.ts";

async function tick(): Promise<void> {
  // wrangler dev --test-scheduled runs the Worker's scheduled() for this path; the cron string is the one it runs on.
  const answer = await fetch(`${API_ORIGIN}/__scheduled?cron=${encodeURIComponent("*/5 * * * *")}`);
  if (!answer.ok) throw new Error(`the cron did not run (${String(answer.status)}): is npm run dev:all running?`);
  console.log("the cron ran: its jobs log to the api's output");
}

/** The webhook's secret as mm-api holds it locally, from .dev.vars. */
function webhookSecret(): string {
  const text = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
  const secret = /^RAZORPAY_WEBHOOK_SECRET=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  if (secret === "") {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is empty in .dev.vars: copy its value from .dev.vars.example, then restart npm run dev:all",
    );
  }
  return secret;
}

interface Hold {
  readonly id: string;
  readonly person_id: string;
  readonly razorpay_order_id: string | null;
  readonly amount: number;
}

async function pay(holdId: string | undefined): Promise<void> {
  const which = holdId === undefined ? "" : `AND id = '${holdId.replaceAll("'", "")}'`;
  const [hold] = d1Query<Hold>(
    "local",
    `SELECT id, person_id, razorpay_order_id, amount FROM slot_holds WHERE state = 'held' ${which}
     ORDER BY created_at DESC LIMIT 1;`,
  );
  if (hold === undefined) throw new Error("no booking is waiting to be paid: hold a visit in the client app first");
  if (hold.razorpay_order_id === null) {
    throw new Error(`hold ${hold.id} has no order yet: go on to payment in the app first (a free visit never has one)`);
  }

  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: `pay_local_${randomUUID().slice(0, 8)}`,
          entity: "payment",
          amount: hold.amount,
          currency: "INR",
          status: "captured",
          order_id: hold.razorpay_order_id,
          method: "upi",
          vpa: "local@upi",
          notes: { hold_id: hold.id, person_id: hold.person_id },
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  });
  const answer = await fetch(`${API_ORIGIN}/api/hooks/razorpay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": createHmac("sha256", webhookSecret()).update(body).digest("hex"),
      "X-Razorpay-Event-Id": `evt_local_${randomUUID()}`,
    },
    body,
  });
  if (!answer.ok) throw new Error(`the webhook answered ${String(answer.status)}: ${await answer.text()}`);
  console.log(`paid hold ${hold.id} (Rs. ${String(hold.amount / 100)}): the webhook books it`);
}

interface OpenVisit {
  readonly id: string;
  readonly type: string | null;
  readonly window_start: string | null;
  readonly name: string | null;
}

async function close(visitId: string | undefined, outcome: "done" | "partial"): Promise<void> {
  if (visitId === undefined) {
    const open = d1Query<OpenVisit>(
      "local",
      `SELECT a.id, a.type, a.window_start, p.name FROM appointments a LEFT JOIN people p ON p.id = a.person_id
       WHERE a.status IN ('scheduled', 'dispatched', 'in_progress') AND a.deleted_at IS NULL
       ORDER BY a.window_start LIMIT 20;`,
    );
    for (const visit of open) {
      console.log(
        `${visit.id}  ${visit.window_start ?? "no time"}  ${visit.type ?? "?"}  ${visit.name ?? "no client"}`,
      );
    }
    console.log("npm run close:local -- <visit-id> [--partial] closes one");
    return;
  }
  const answer = await fetch(`${API_ORIGIN}/api/dev/appointments/${visitId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome }),
  });
  if (!answer.ok) throw new Error(`closing answered ${String(answer.status)}: ${await answer.text()}`);
  console.log(`closed ${visitId}, ${outcome}: npm run tick runs what follows a close, such as the invoice`);
}

const [command, argument, flag] = process.argv.slice(2);
const COMMANDS: Readonly<Record<string, () => Promise<void>>> = {
  tick,
  pay: () => pay(argument),
  close: () => close(argument, flag === "--partial" ? "partial" : "done"),
};
const run = command === undefined ? undefined : COMMANDS[command];
if (run === undefined) {
  console.error("usage: node scripts/dev/local.ts <tick | pay [hold-id] | close [visit-id] [--partial]>");
  process.exit(2);
}
try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
