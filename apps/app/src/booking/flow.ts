// The booking sheet's steps, and the step each thing that happens to it leads to (BookingSheet.tsx). Pure, so every
// way through the sheet is tested without a browser (test/node/apps/app/app-booking-flow.test.ts). An event that does not
// belong to the step the sheet is on changes nothing: an answer that comes back after the client moved on is dropped.

// The types from the generated schema, not ../api.ts, so the flow is read in Node without the fetch client.
import type { components } from "../api-schema.ts";

type Address = components["schemas"]["Address"];
type Hold = components["schemas"]["Hold"];

export type Step =
  | { readonly kind: "loading" }
  /**
   * No address yet (ADR 0079), or the client changing the one saved from the review. `refused`: the API refused a hold
   * for want of one.
   */
  | { readonly kind: "address"; readonly refused: boolean; readonly changing?: boolean }
  /** The address saved is in a pincode we do not come to. */
  | { readonly kind: "notServed"; readonly address: Address }
  /** More than one service is open to the client, and they pick one (ADR 0085). */
  | { readonly kind: "service" }
  /** The day and the start on it, chosen on one screen. */
  | { readonly kind: "when" }
  /** No days: the hair system is made to order in the client's size, which ops order and book on WhatsApp. */
  | { readonly kind: "madeToOrder" }
  | { readonly kind: "pay"; readonly hold: Hold }
  | { readonly kind: "failed"; readonly hold: Hold }
  | { readonly kind: "expired" }
  /** `paidIn`: the phone saw the hold's time end, and found the payment already in. */
  | { readonly kind: "confirming"; readonly hold: Hold; readonly paidIn?: boolean }
  | { readonly kind: "confirmed"; readonly hold: Hold }
  /** Still being booked after a minute; paid, it is told by its receipt, whatever the client's consent. */
  | { readonly kind: "slow"; readonly paid: boolean }
  | { readonly kind: "refunded" }
  | { readonly kind: "broken" };

/** What can happen to the sheet: what the API answered, what the client did, and what the clock or Checkout said. */
export type BookingEvent =
  /** The sheet asks the API again: on opening, after a pick, an address saved, or a lapse. */
  | { readonly kind: "asking" }
  /** The profile is in, and the days of the visit wanted; `picking` where no visit is wanted yet. */
  | { readonly kind: "answered"; readonly picking: boolean; readonly addressMissing: boolean }
  | { readonly kind: "addressNeeded"; readonly refused: boolean }
  /** The API offers nothing at this address; with none known, the sheet cannot say where. */
  | { readonly kind: "notServed"; readonly address: Address | null }
  /** The API leaves the visit to ops: its hair system is made to order in the client's size. */
  | { readonly kind: "madeToOrder" }
  | { readonly kind: "failed" }
  /** The client stepped back: from the review to the day and time, or from those to the service. */
  | { readonly kind: "back" }
  /** The client changes their address from the review, which lets the time go. */
  | { readonly kind: "changeAddress" }
  /** A start is held, or the hold is read again with its price. */
  | { readonly kind: "held"; readonly hold: Hold }
  | { readonly kind: "paid"; readonly hold: Hold; readonly paidIn?: boolean }
  | { readonly kind: "payFailed"; readonly hold: Hold }
  /** The hold's time ran out with nothing paid, or the API says it already had. */
  | { readonly kind: "lapsed" }
  | { readonly kind: "booked"; readonly hold: Hold }
  | { readonly kind: "refunded" }
  /** A minute of asking, and the visit is still not booked. */
  | { readonly kind: "slow"; readonly paid: boolean };

/** The steps a hold waits on the client in, until it is paid for or its time runs out. */
const HOLDING: ReadonlySet<Step["kind"]> = new Set(["pay", "failed"]);
/** The steps the sheet is still choosing in, which an answer from the API moves on from. */
const CHOOSING: ReadonlySet<Step["kind"]> = new Set(["loading", "service", "when", "address", "notServed"]);

/** The step `event` leads to from `step`; `step` itself where the event does not belong to it. */
export function nextStep(step: Step, event: BookingEvent): Step {
  switch (event.kind) {
    case "asking":
      return { kind: "loading" };
    case "answered":
      if (step.kind !== "loading") return step;
      // A pick comes first; the address is asked for once the days of the visit picked are in.
      if (event.picking) return { kind: "service" };
      return event.addressMissing ? { kind: "address", refused: false } : { kind: "when" };
    case "addressNeeded":
      return CHOOSING.has(step.kind) ? { kind: "address", refused: event.refused } : step;
    case "notServed":
      if (!CHOOSING.has(step.kind)) return step;
      return event.address === null ? { kind: "broken" } : { kind: "notServed", address: event.address };
    case "madeToOrder":
      return CHOOSING.has(step.kind) ? { kind: "madeToOrder" } : step;
    case "failed":
      return CHOOSING.has(step.kind) ? { kind: "broken" } : step;
    case "back":
      if (HOLDING.has(step.kind)) return { kind: "when" };
      return step.kind === "when" || step.kind === "madeToOrder" ? { kind: "service" } : step;
    case "changeAddress":
      return HOLDING.has(step.kind) ? { kind: "address", refused: false, changing: true } : step;
    case "held":
      return step.kind === "when" || HOLDING.has(step.kind) ? { kind: "pay", hold: event.hold } : step;
    case "paid":
      return HOLDING.has(step.kind) ? { kind: "confirming", hold: event.hold, paidIn: event.paidIn } : step;
    case "payFailed":
      return HOLDING.has(step.kind) ? { kind: "failed", hold: event.hold } : step;
    case "lapsed":
      return HOLDING.has(step.kind) ? { kind: "expired" } : step;
    case "booked":
      return step.kind === "confirming" ? { kind: "confirmed", hold: event.hold } : step;
    case "refunded":
      return step.kind === "confirming" ? { kind: "refunded" } : step;
    case "slow":
      return step.kind === "confirming" ? { kind: "slow", paid: event.paid } : step;
  }
}

/** The hold a step waits on the client with, whose time is counting down; null on any other step. */
export const holdOf = (step: Step): Hold | null => (step.kind === "pay" || step.kind === "failed" ? step.hold : null);
