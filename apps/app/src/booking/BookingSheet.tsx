// Booking a visit in the app (boards C2 to C6), while self-serve booking is on
// (docs/decisions/0045-self-serve-booking.md). A sheet rises: the date, the
// window, then paying through Razorpay Checkout. Paid, the sheet waits while
// Razorpay's webhook confirms and the visit is booked in FSM, polling the hold.
// Closed before paying, the hold is let go. Moving a visit (board C7) takes the
// same steps, with its own technician and at what the move costs.
//
// The hold's ten minutes are counted on the API's clock, not the phone's
// (lib/clock.ts), and when the phone sees them run out it lets the hold go too.

import { Sheet } from "@maneman/ui/Sheet";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Availability,
  type BookableType,
  type Booking,
  type BookingWindow,
  type Hold,
  type MoveTerms,
  type Profile,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "../lib/arrival.ts";
import { apiNow } from "../lib/clock.ts";
import { loadCheckout, pay, type Paid, type PayMethod } from "./checkout.ts";
import {
  ConfirmedStep,
  DateStep,
  ExpiredStep,
  FailedStep,
  LoadingStep,
  paysNothing,
  PayStep,
  TITLE_ID,
  WaitStep,
  WindowStep,
} from "./steps.tsx";
import styles from "./booking.module.css";

type Step =
  | { readonly kind: "loading" }
  | { readonly kind: "date" }
  | { readonly kind: "window" }
  | { readonly kind: "pay"; readonly hold: Hold }
  | { readonly kind: "failed"; readonly hold: Hold }
  | { readonly kind: "expired" }
  /** `paidIn`: the phone saw the hold's time end, and found the payment already in. */
  | { readonly kind: "confirming"; readonly hold: Hold; readonly paidIn?: boolean }
  | { readonly kind: "confirmed"; readonly hold: Hold }
  | { readonly kind: "slow" }
  | { readonly kind: "refunded" }
  | { readonly kind: "broken" };

/** How often, and for how long, the sheet asks whether a paid hold is booked. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

/** Whether the client has switched on WhatsApp about their visits, the purpose the day-before reminder is sent under. */
const remindersOn = (profile: Profile) =>
  profile.consents.some((consent) => consent.purpose === "whatsapp_visits" && consent.granted);

export function BookingSheet({
  type,
  moving,
  onClose,
}: {
  type: BookableType;
  /** The visit being moved, and what moving it costs. */
  moving?: MoveTerms;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}) {
  const movingId = moving?.visit_id;
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [chosenWindow, setChosenWindow] = useState<BookingWindow | null>(null);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Whether reminders are on: null when the profile could not say, and the sheet asks. */
  const [reminders, setReminders] = useState<boolean | null>(null);
  const [remind, setRemind] = useState(false);
  // True once the client has paid, or booked without paying, so Home is fetched again when the sheet closes.
  const changed = useRef(false);
  // True while Razorpay Checkout is open, and this sheet has stepped out of its way.
  const paying = useRef(false);
  // True from the tap until Checkout has answered. `busy` disables the buttons, but only on
  // the next render, and a tap in that gap would pay for the hold a second time (ADR 0057).
  const starting = useRef(false);

  const load = useCallback(async () => {
    setStep({ kind: "loading" });
    const [answer, profile] = await Promise.all([api.availability(type, movingId), api.profile()]);
    if (!answer.ok) {
      setStep({ kind: "broken" });
      return;
    }
    setReminders(profile.ok ? remindersOn(profile.body) : null);
    setAvailability(answer.body);
    setDate(null);
    setChosenWindow(null);
    setStep({ kind: "date" });
  }, [type, movingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Each step's heading takes the focus the last step's button took with it.
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind]);

  // The hold has lapsed while the client was paying or deciding. The phone may see it before the API
  // does, so it lets the hold go itself, rather than leave the slot blocked for no one. A payment
  // Razorpay took in time keeps the hold, though (ADR 0068), so the API is asked first.
  const holdOf = step.kind === "pay" || step.kind === "failed" ? step.hold : null;
  useEffect(() => {
    if (holdOf === null) return;
    const lapse = async () => {
      const now = await api.holdById(holdOf.id);
      if (now.ok && now.body.paid) {
        changed.current = true;
        setStep({ kind: "confirming", hold: now.body, paidIn: true });
        return;
      }
      setStep({ kind: "expired" });
      void api.releaseHold(holdOf.id);
    };
    const timer = window.setTimeout(() => void lapse(), Math.max(0, Date.parse(holdOf.expires_at) - apiNow()));
    return () => {
      window.clearTimeout(timer);
    };
  }, [holdOf]);

  // Checkout's script loads as soon as there is something to pay, so paying starts at once. A script
  // that fails here is tried again at the tap, which is where the client is told.
  const toPay = step.kind === "pay" && !paysNothing(step.hold);
  useEffect(() => {
    if (toPay) loadCheckout().catch(() => undefined);
  }, [toPay]);

  // Paid, or free: asks every two seconds, for a minute, whether the visit is booked.
  const confirming = step.kind === "confirming" ? step.hold : null;
  useEffect(() => {
    if (confirming === null) return;
    const started = Date.now();
    let current = true;
    const ask = async () => {
      const answer = await api.holdById(confirming.id);
      if (!current) return;
      if (answer.ok && answer.body.state === "booked") setStep({ kind: "confirmed", hold: answer.body });
      else if (answer.ok && answer.body.state === "released") setStep({ kind: "refunded" });
      else if (Date.now() - started > POLL_FOR_MS) setStep({ kind: "slow" });
      else timer = window.setTimeout(() => void ask(), POLL_MS);
    };
    let timer = window.setTimeout(() => void ask(), POLL_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [confirming]);

  const close = () => dialog.current?.close();

  const holdWindow = async () => {
    if (date === null || chosenWindow === null) return;
    setBusy(true);
    setProblem(null);
    const answer = await api.hold(type, date, chosenWindow, movingId);
    setBusy(false);
    if (answer.ok) setStep({ kind: "pay", hold: answer.body });
    else if (answer.code === "taken") {
      setProblem(booking.window.taken);
      const fresh = await api.availability(type, movingId);
      if (fresh.ok) setAvailability(fresh.body);
      setChosenWindow(null);
    } else setProblem(booking.failedToStart);
  };

  /**
   * A sheet opened with showModal() sits in the browser's top layer and makes
   * the rest of the page inert, so Checkout's own window would be drawn under
   * it and take no taps (proven on staging, 23 September 2026). The sheet
   * therefore closes while Checkout is up, and rises again with the answer;
   * `paying` keeps that close from letting the hold go. Checkout's script is
   * waited for first, with the sheet still up and busy, so a script that
   * never comes ends on the sheet's own payment-failed step.
   */
  const throughCheckout = async (checkout: NonNullable<Booking["checkout"]>, how: PayMethod): Promise<Paid> => {
    const ready = await loadCheckout().then(
      () => true,
      () => false,
    );
    if (!ready) return "failed";
    paying.current = true;
    dialog.current?.close();
    const outcome = await pay(checkout, how).catch(() => "failed" as const);
    dialog.current?.showModal();
    paying.current = false;
    return outcome;
  };

  /** The client ticked "Remind me": their yes to WhatsApp about their visits, on that purpose's own notice. */
  const switchOnReminders = async () => {
    const answer = await api.switchConsent("whatsapp_visits", true);
    if (answer.ok) setReminders(true);
  };

  const payFor = async (hold: Hold, how: PayMethod) => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (remind && reminders !== true) await switchOnReminders();
      const started = movingId === undefined ? await api.book(hold.id) : await api.startMove(movingId, hold.id);
      if (!started.ok) {
        setBusy(false);
        if (started.code === "hold_expired") setStep({ kind: "expired" });
        else setProblem(booking.failedToStart);
        return;
      }
      const checkout = started.body.checkout;
      const outcome = checkout === null ? "paid" : await throughCheckout(checkout, how);
      setBusy(false);
      if (outcome === "paid") {
        changed.current = true;
        setStep({ kind: "confirming", hold });
      } else if (outcome === "failed") setStep({ kind: "failed", hold });
    } finally {
      starting.current = false;
    }
  };

  const day = availability?.days.find((each) => each.date === date);
  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy={TITLE_ID}
      onClose={() => {
        // Stepping out of Checkout's way is not the client closing the sheet (Sheet ignores that close's
        // event if it arrives after the sheet has risen again).
        if (paying.current) return;
        // Closed before it was paid for, the hold is let go for someone else.
        if (step.kind === "pay" || step.kind === "failed") void api.releaseHold(step.hold.id);
        onClose(changed.current);
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      <div className={styles.sheet}>
        {step.kind === "loading" && <LoadingStep />}
        {step.kind === "broken" && <WaitStep text={booking.failedToStart} onClose={close} />}
        {step.kind === "date" && availability !== null && (
          <DateStep
            days={availability.days}
            chosen={date}
            onChoose={setDate}
            onNext={() => {
              setStep({ kind: "window" });
            }}
          />
        )}
        {step.kind === "window" && day !== undefined && availability !== null && (
          <WindowStep
            day={day}
            regular={availability.regular}
            chosen={chosenWindow}
            busy={busy}
            problem={problem}
            onChoose={setChosenWindow}
            onNext={() => void holdWindow()}
          />
        )}
        {step.kind === "pay" && (
          <PayStep
            hold={step.hold}
            moving={moving}
            method={method}
            busy={busy}
            problem={problem}
            askToRemind={reminders !== true}
            remind={remind}
            onRemind={setRemind}
            onMethod={setMethod}
            onPay={() => void payFor(step.hold, method)}
          />
        )}
        {step.kind === "failed" && (
          <FailedStep
            hold={step.hold}
            busy={busy}
            onRetry={() => void payFor(step.hold, method)}
            onAnother={() => {
              const other = method === "upi" ? "card" : "upi";
              setMethod(other);
              void payFor(step.hold, other);
            }}
          />
        )}
        {step.kind === "expired" && <ExpiredStep onPickAgain={() => void load()} />}
        {step.kind === "confirming" && <WaitStep text={step.paidIn === true ? booking.paidIn : booking.confirming} />}
        {step.kind === "confirmed" && (
          <ConfirmedStep hold={step.hold} moved={moving !== undefined} reminded={reminders === true} onDone={close} />
        )}
        {step.kind === "slow" && <WaitStep text={booking.slow} onClose={close} />}
        {step.kind === "refunded" && <WaitStep text={booking.refunded} onClose={close} />}
      </div>
    </Sheet>
  );
}
