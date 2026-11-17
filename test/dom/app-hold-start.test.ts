// Holding the start chosen (apps/app/src/booking/sheet-actions.ts): what the booking sheet does with each of the API's
// refusals. A time taken is said and the day asked for again; no address asks for one; an address not served says so;
// and a hair system made to order in the client's size takes the sheet to its own step (ADR 0253, decision 6).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingEvent } from "../../apps/app/src/booking/flow.ts";
import { useHoldStart } from "../../apps/app/src/booking/sheet-actions.ts";
import type { Days } from "../../apps/app/src/booking/useDays.ts";
import { booking } from "../../apps/app/src/content.ts";
import { contractChecked } from "./contract-fetch.ts";

const DATE = "2026-11-20";
const START = "2026-11-20T04:30:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The API refusing every hold with `code`, at its status. */
function refusing(status: number, code: string) {
  vi.stubGlobal(
    "fetch",
    contractChecked("client", (url, init) =>
      url.endsWith("/api/holds") && init.method === "POST"
        ? Response.json({ error: { code, request_id: "test" } }, { status })
        : undefined,
    ),
  );
}

/** Holding the start chosen on DATE, each thing the sheet then does written down in the order it happened. */
async function hold() {
  const done: string[] = [];
  const days = {
    date: DATE,
    chosenStart: START,
    askAgainFrom: (_wanted: unknown, from: string) => {
      done.push(`ask again from ${from}`);
      return Promise.resolve();
    },
  } as unknown as Days;
  const start = useHoldStart({
    once: (work) => work(),
    wanted: { type: "replacement", tier: "essential" },
    days,
    movingId: undefined,
    setProblem: (problem) => done.push(`problem ${String(problem)}`),
    dispatch: (event: BookingEvent) => done.push(`step ${event.kind}`),
    askForAddress: (refused) => done.push(`address ${String(refused)}`),
    showNotServed: () => done.push("not served"),
  });
  await start();
  return done;
}

describe("a hold the API refuses", () => {
  it("takes the sheet to its own step where the hair system is made to order in the client's size", async () => {
    refusing(422, "made_to_order");
    expect(await hold()).toEqual(["problem null", "step madeToOrder"]);
  });

  it("says where it does not come, asks for an address, or says the time was taken and asks for the day again", async () => {
    refusing(422, "not_served");
    expect(await hold()).toEqual(["problem null", "not served"]);
    refusing(409, "address_required");
    expect(await hold()).toEqual(["problem null", "address true"]);
    refusing(409, "taken");
    expect(await hold()).toEqual(["problem null", `problem ${booking.when.gone}`, `ask again from ${DATE}`]);
  });
});
