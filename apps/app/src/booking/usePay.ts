// Paying for a hold from the booking sheet (./BookingSheet.tsx): starting the booking, Razorpay Checkout, and what its
// answer or the hold's clock leads to. The hold that has an order is never let go by the app: a payment may still land
// on it, and the API lets it go once its grace ends.

import { useEffect, useRef, type Dispatch, type RefObject } from "react";
import { api, type Hold } from "../api.ts";
import { booking } from "../content.ts";
import { apiNow } from "@maneman/web-kit/clock";
import { loadCheckout, type Paid } from "./checkout.ts";
import { holdOf, type BookingEvent, type Step } from "./flow.ts";
import { useHoldLapse, usePollHold } from "./hold-clocks.ts";
import { paysNothing, throughCheckout } from "./pay.ts";

/** Whether the hold's countdown has run out, by the API's clock. */
const hasRunOut = (hold: Hold) => apiNow() >= Date.parse(hold.expires_at);

interface Paying {
  readonly dialog: RefObject<HTMLDialogElement | null>;
  readonly dispatch: Dispatch<BookingEvent>;
  /** The visit being moved; undefined for a new one. */
  readonly movingId: string | undefined;
  /** The photograph purposes booking a new visit also agrees to. */
  /** What the client asked for on the pay step before the booking starts: their reminders switched on. */
  readonly beforeStarting: () => Promise<void>;
  /** The sheet's one-tap guard (packages/ui/useOneAtATime.ts), which holding a window shares. */
  readonly once: (work: () => Promise<void>) => Promise<void>;
  readonly setProblem: (problem: string | null) => void;
}

interface Refs {
  /** True while Razorpay Checkout is open, and the sheet has stepped out of its way. */
  readonly paying: { current: boolean };
  /** The hold that has a Razorpay order. */
  readonly ordered: { current: string | null };
}

/** The visit credit this hold counted on went on another booking: the client sees the price before Checkout opens. */
async function showPriceInstead(holdId: string, context: Paying): Promise<void> {
  const fresh = await api.holdById(holdId);
  if (!fresh.ok) {
    context.setProblem(booking.failedToStart);
    return;
  }
  context.dispatch({ kind: "held", hold: fresh.body });
  context.setProblem(booking.creditGone);
}

/** The booking started, and Checkout's answer; null when the API would not start it, or the price must show first. */
async function startPaying(hold: Hold, context: Paying, refs: Refs): Promise<Paid | null> {
  await context.beforeStarting();
  const started =
    context.movingId === undefined ? await api.book(hold.id) : await api.startMove(context.movingId, hold.id);
  if (!started.ok) {
    if (started.code === "hold_expired") context.dispatch({ kind: "lapsed" });
    else context.setProblem(booking.failedToStart);
    return null;
  }
  const checkout = started.body.checkout;
  if (checkout === null) return "paid";
  refs.ordered.current = hold.id;
  if (paysNothing(hold)) {
    await showPriceInstead(hold.id, context);
    return null;
  }
  return throughCheckout(context.dialog.current, refs.paying, checkout, hold.pay_by);
}

/**
 * Paying for the step's hold: `payFor` to start, `letGo` for a hold the sheet closed on, `changed` once money moved or
 * a visit was booked, and `paying` while Checkout is up. When the phone sees the countdown end it lets the hold go too,
 * but not while Checkout is open: it waits for Checkout's answer.
 */
export function usePay(step: Step, context: Paying) {
  const changed = useRef(false);
  const paying = useRef(false);
  // True from the tap until Checkout has answered, so the hold's lapse waits for that answer (ADR 0057).
  const starting = useRef(false);
  const ordered = useRef<string | null>(null);
  const { dispatch } = context;

  /** Lets an unpaid hold go for someone else, unless it has an order, which the API lets go once its grace ends. */
  const letGo = (hold: Hold) => {
    if (ordered.current !== hold.id) void api.releaseHold(hold.id);
  };

  // A function, so TypeScript does not take the ref as unchanged across an await.
  const isPaying = () => starting.current;

  /** The hold's time has run out. A payment Razorpay took in time keeps the hold, so the API is asked first. */
  const lapse = async (hold: Hold) => {
    if (isPaying()) return;
    const now = await api.holdById(hold.id);
    if (now.ok && now.body.paid) {
      changed.current = true;
      dispatch({ kind: "paid", hold: now.body, paidIn: true });
      return;
    }
    // The client tapped Pay while the API was answering.
    if (isPaying()) return;
    dispatch({ kind: "lapsed" });
    letGo(hold);
  };

  useHoldLapse(holdOf(step), (hold) => void lapse(hold));
  usePollHold(step.kind === "confirming" ? step.hold : null, dispatch);

  // Checkout's script loads as soon as there is something to pay, so paying starts at once. A script
  // that fails here is tried again at the tap, which is where the client is told.
  const toPay = step.kind === "pay" && !paysNothing(step.hold);
  useEffect(() => {
    if (toPay) loadCheckout().catch(() => undefined);
  }, [toPay]);

  const payFor = (hold: Hold) =>
    context.once(async () => {
      starting.current = true;
      context.setProblem(null);
      const outcome = await startPaying(hold, context, { paying, ordered }).finally(() => {
        starting.current = false;
      });
      if (outcome === "paid") {
        changed.current = true;
        dispatch({ kind: "paid", hold });
        return;
      }
      // The hold's time may have run out while the client was paying, and its lapse waited for this answer.
      if (hasRunOut(hold)) void lapse(hold);
      else if (outcome === "failed") dispatch({ kind: "payFailed", hold });
    });

  return { payFor, letGo, changed, paying };
}
