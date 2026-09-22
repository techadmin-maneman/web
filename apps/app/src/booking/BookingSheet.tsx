// Booking a visit in the app (boards C2 to C6), while self-serve booking is on
// (docs/decisions/0045-self-serve-booking.md). A sheet rises: the date, the
// window, then paying through Razorpay Checkout. Paid, the sheet waits while
// Razorpay's webhook confirms and the visit is booked in FSM, polling the hold.
// Closed before paying, the hold is let go.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Availability, type BookableType, type BookingWindow, type Hold } from "../api.ts";
import { booking } from "../content.ts";
import { pay, type PayMethod } from "./checkout.ts";
import { ConfirmedStep, DateStep, ExpiredStep, FailedStep, PayStep, WaitStep, WindowStep } from "./steps.tsx";
import styles from "./booking.module.css";

type Step =
  | { readonly kind: "loading" }
  | { readonly kind: "date" }
  | { readonly kind: "window" }
  | { readonly kind: "pay"; readonly hold: Hold }
  | { readonly kind: "failed"; readonly hold: Hold }
  | { readonly kind: "expired" }
  | { readonly kind: "confirming"; readonly hold: Hold }
  | { readonly kind: "confirmed"; readonly hold: Hold }
  | { readonly kind: "slow" }
  | { readonly kind: "refunded" }
  | { readonly kind: "broken" };

/** How often, and for how long, the sheet asks whether a paid hold is booked. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

export function BookingSheet({ type, onClose }: { type: BookableType; onClose: (booked: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [chosenWindow, setChosenWindow] = useState<BookingWindow | null>(null);
  const [method, setMethod] = useState<PayMethod>("upi");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const booked = useRef(false);

  const load = useCallback(async () => {
    setStep({ kind: "loading" });
    const answer = await api.availability(type);
    if (!answer.ok) {
      setStep({ kind: "broken" });
      return;
    }
    setAvailability(answer.body);
    setDate(null);
    setChosenWindow(null);
    setStep({ kind: "date" });
  }, [type]);

  useEffect(() => {
    dialog.current?.showModal();
    void load();
  }, [load]);

  // The hold has lapsed while the client was paying or deciding.
  const holdOf = step.kind === "pay" || step.kind === "failed" ? step.hold : null;
  useEffect(() => {
    if (holdOf === null) return;
    const timer = window.setTimeout(
      () => {
        setStep({ kind: "expired" });
      },
      Math.max(0, Date.parse(holdOf.expires_at) - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [holdOf]);

  // Paid, or free: asks every two seconds, for a minute, whether the visit is booked.
  const confirming = step.kind === "confirming" ? step.hold : null;
  useEffect(() => {
    if (confirming === null) return;
    const started = Date.now();
    let current = true;
    const ask = async () => {
      const answer = await api.holdById(confirming.id);
      if (!current) return;
      if (answer.ok && answer.body.state === "booked") {
        booked.current = true;
        setStep({ kind: "confirmed", hold: answer.body });
      } else if (answer.ok && answer.body.state === "released") setStep({ kind: "refunded" });
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
    const answer = await api.hold(type, date, chosenWindow);
    setBusy(false);
    if (answer.ok) setStep({ kind: "pay", hold: answer.body });
    else if (answer.code === "taken") {
      setProblem(booking.window.taken);
      const fresh = await api.availability(type);
      if (fresh.ok) setAvailability(fresh.body);
      setChosenWindow(null);
    } else setProblem(booking.failedToStart);
  };

  const payFor = async (hold: Hold, how: PayMethod) => {
    setBusy(true);
    setProblem(null);
    const started = await api.book(hold.id);
    if (!started.ok) {
      setBusy(false);
      if (started.code === "hold_expired") setStep({ kind: "expired" });
      else setProblem(booking.failedToStart);
      return;
    }
    const checkout = started.body.checkout;
    const outcome = checkout === null ? "paid" : await pay(checkout, how).catch(() => "failed" as const);
    setBusy(false);
    if (outcome === "paid") setStep({ kind: "confirming", hold });
    else if (outcome === "failed") setStep({ kind: "failed", hold });
  };

  const day = availability?.days.find((each) => each.date === date);
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="booking-title"
      onClose={() => {
        // Closed before it was paid for, the hold is let go for someone else.
        if (step.kind === "pay" || step.kind === "failed") void api.releaseHold(step.hold.id);
        onClose(booked.current);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      {step.kind === "loading" && <div className={styles.loading} aria-busy="true" />}
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
          method={method}
          busy={busy}
          problem={problem}
          onMethod={setMethod}
          onPay={() => void payFor(step.hold, method)}
        />
      )}
      {step.kind === "failed" && (
        <FailedStep
          hold={step.hold}
          onRetry={() => void payFor(step.hold, method)}
          onAnother={() => {
            const other = method === "upi" ? "card" : "upi";
            setMethod(other);
            void payFor(step.hold, other);
          }}
        />
      )}
      {step.kind === "expired" && <ExpiredStep onPickAgain={() => void load()} />}
      {step.kind === "confirming" && <WaitStep text={booking.confirming} />}
      {step.kind === "confirmed" && <ConfirmedStep hold={step.hold} onDone={close} />}
      {step.kind === "slow" && <WaitStep text={booking.slow} onClose={close} />}
      {step.kind === "refunded" && <WaitStep text={booking.refunded} onClose={close} />}
    </dialog>
  );
}
