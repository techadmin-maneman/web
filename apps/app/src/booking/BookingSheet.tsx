// Booking a visit in the app, while self-serve booking is on
// (docs/decisions/0045-self-serve-booking.md). A sheet rises: the date, the
// window, then paying through Razorpay Checkout. Paid, the sheet waits while
// Razorpay's webhook confirms and the visit is booked, polling the hold.
// Closed before Checkout was opened on it, the hold is let go; after, a payment
// may still land on its order, and the API lets it go once its grace ends.
// Moving a visit takes the same steps, with its own technician and
// at what the move costs.
//
// With more than one service open to them, a client picks theirs first, from
// every one ops offer (docs/decisions/0085-services-ops-can-edit.md). A client
// who has given no address is asked for it before the date, since no slot is
// held without one (ADR 0079); one whose address is in a pincode we do not come
// to is offered no day, and changes the address or joins the waitlist. The pay
// step of a new visit says what booking also agrees to, and its tap sends that
// on (ADR 0080).
//
// Opened with the visit the app offers next, the sheet starts its strip a week
// before the day offered and has that day and window chosen where they are
// free, for the client to take or change (ADR 0086). With the day offered full,
// the next open day is chosen. Later days are added to the strip on asking, up
// to the last a visit may be booked on.
//
// The steps, and the step each answer, tap or clock leads to, are flow.ts's; the
// hold's countdown and the wait for a paid one to be booked are hold-clocks.ts's.
// When the phone sees the countdown end it lets the hold go too, but not while
// Checkout is open: it waits for Checkout's answer.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { addDays } from "@maneman/web-kit/dates";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  api,
  type BookableType,
  type BookingWindow,
  type Hold,
  type MoveTerms,
  type OfferedService,
  type Wanted,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { drawsItsOwnClose, nextStep, type Step } from "./flow.ts";
import { hasLaterDays } from "./days.ts";
import type { Days } from "./use-days.ts";
import { useSheetData } from "./use-sheet-data.ts";
import { usePay } from "./use-pay.ts";
import { AddressStep, NotServedStep } from "./steps/AddressStep.tsx";
import { ConfirmedStep, ExpiredStep, FailedStep, WaitStep } from "./steps/OutcomeSteps.tsx";
import { DateStep } from "./steps/DateStep.tsx";
import { LoadingStep, TITLE_ID } from "./steps/shared.tsx";
import { PayStep } from "./steps/PayStep.tsx";
import { ServiceStep, type Recommended } from "./steps/ServiceStep.tsx";
import { WindowStep } from "./steps/WindowStep.tsx";
import styles from "./booking.module.css";

/**
 * What a sheet with nothing to pick books: the one service open to the client, or else the kind's standard one;
 * for a move, its visit's own, which the API knows.
 */
function onlyOne(type: BookableType, services: readonly OfferedService[], moving: MoveTerms | undefined): Wanted {
  const [only] = services;
  return moving === undefined && only !== undefined ? { type: only.type, tier: only.tier } : { type };
}

/** The day and window a visit is offered on, which the sheet opens with chosen. */
export interface Offered {
  readonly date: string;
  readonly window: BookingWindow | null;
}

/** How many days before the day offered the strip starts, so a week either side of it is in view. */
const OFFER_WEEK = 7;

interface Props {
  /** The kind booked when there is nothing to pick: a move's own, or the one open to the client. */
  type: BookableType;
  /** Every service open to the client, a kind at a time; with more than one, the client picks theirs first. */
  services?: readonly OfferedService[];
  /** The service the app offers among them, chosen when the sheet opens for the client to take or change. */
  tier?: string;
  /** The hair system the consultation recommended, marked among a first fit's. */
  recommended?: Recommended;
  /** The visit being moved, and what moving it costs. */
  moving?: MoveTerms;
  /** The strip's first day, where it should not start from the first day open. */
  from?: string;
  /** The day and window the visit is offered on (ADR 0086), chosen where they are free. */
  offer?: Offered;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}

/** The day, then the window on it, which is held as the client goes on. */
function DayAndWindow(props: {
  step: Step;
  before: number;
  days: Days;
  wanted: Wanted | null;
  offered: string | null;
  busy: boolean;
  problem: string | null;
  onDayTaken: () => void;
  onHold: () => void;
}) {
  const { step, before, days } = props;
  const { availability } = days;
  if (availability === null) return null;
  if (step.kind === "date") {
    const later = hasLaterDays(availability)
      ? {
          busy: days.laterAsk === "busy",
          failed: days.laterAsk === "failed",
          onShow: () => void days.showLater(props.wanted),
        }
      : null;
    return (
      <DateStep
        before={before}
        days={availability.days}
        noticeHours={availability.change_notice_hours}
        offered={props.offered}
        chosen={days.date}
        later={later}
        onChoose={days.chooseDate}
        onNext={props.onDayTaken}
      />
    );
  }
  const day = availability.days.find((each) => each.date === days.date);
  if (step.kind !== "window" || day === undefined) return null;
  return (
    <WindowStep
      before={before}
      day={day}
      noticeHours={availability.change_notice_hours}
      chosen={days.chosenWindow}
      busy={props.busy}
      problem={props.problem}
      onChoose={days.setChosenWindow}
      onNext={props.onHold}
    />
  );
}

/** The steps once a window is held: paying for it, and what came of that. */
function HeldSteps(props: {
  step: Step;
  moving: MoveTerms | undefined;
  busy: boolean;
  problem: string | null;
  reminders: boolean | null;
  remind: boolean;
  onRemind: (remind: boolean) => void;
  onPay: (hold: Hold) => void;
  onHeld: (hold: Hold) => void;
  onPickAgain: () => void;
  onClose: () => void;
}) {
  const { step, reminders } = props;
  switch (step.kind) {
    case "pay":
      return (
        <PayStep
          hold={step.hold}
          moving={props.moving}
          busy={props.busy}
          problem={props.problem}
          askToRemind={reminders !== true}
          remind={props.remind}
          onRemind={props.onRemind}
          onPay={() => {
            props.onPay(step.hold);
          }}
          onHold={props.onHeld}
        />
      );
    case "failed":
      return (
        <FailedStep
          hold={step.hold}
          busy={props.busy}
          onRetry={() => {
            props.onPay(step.hold);
          }}
        />
      );
    case "expired":
      return <ExpiredStep onPickAgain={props.onPickAgain} />;
    case "confirming":
      return <WaitStep text={step.paidIn === true ? booking.paidIn : booking.confirming} />;
    case "confirmed":
      return (
        <ConfirmedStep
          hold={step.hold}
          moved={props.moving !== undefined}
          reminded={reminders === true}
          onDone={props.onClose}
        />
      );
    case "slow":
      return (
        <WaitStep text={step.paid || reminders === true ? booking.slow : booking.slowQuiet} onClose={props.onClose} />
      );
    case "refunded":
      return <WaitStep text={booking.refunded} onClose={props.onClose} />;
    // The steps before a window is held, which the sheet draws itself.
    case "loading":
    case "broken":
    case "service":
    case "address":
    case "notServed":
    case "date":
    case "window":
      return null;
  }
}

export function BookingSheet({ type, services = [], tier, recommended, moving, from, offer, onClose }: Props) {
  const movingId = moving?.visit_id;
  const offeredDate = offer?.date;
  const offeredWindow = offer?.window;
  const firstDay = from ?? (offeredDate === undefined ? undefined : addDays(offeredDate, -OFFER_WEEK));
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, dispatch] = useReducer(nextStep, { kind: "loading" });
  // A new visit with more than one service open to it is picked first; anything else books the one there is.
  const picking = moving === undefined && services.length > 1;
  const [wanted, setWanted] = useState<Wanted | null>(() => (picking ? null : onlyOne(type, services, moving)));
  const [picked, setPicked] = useState<OfferedService | null>(
    () => services.find((service) => service.tier === tier) ?? null,
  );
  const [busy, once] = useOneAtATime();
  const [problem, setProblem] = useState<string | null>(null);
  const [remind, setRemind] = useState(false);
  const sheet = useSheetData({ dispatch, movingId, firstDay, offeredDate, offeredWindow, wanted, setWanted });
  const { days, reminders, setReminders, addressFirst, askForAddress, showNotServed, load, pick } = sheet;
  const { availability, date, chosenWindow } = days;

  // Each step's heading takes the focus the last step's button took with it, as it does when "Later dates" goes with
  // the last of them.
  const daysShown = availability?.days.length;
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind, daysShown]);

  const close = () => dialog.current?.close();

  const holdWindow = () =>
    once(async () => {
      if (wanted === null || date === null || chosenWindow === null) return;
      setProblem(null);
      const answer = await api.hold(wanted, date, chosenWindow, movingId);
      if (answer.ok) dispatch({ kind: "held", hold: answer.body });
      else if (answer.code === "taken") {
        setProblem(booking.window.taken);
        await days.askAgainFrom(wanted, date);
      } else if (answer.code === "address_required") askForAddress(true);
      else if (answer.code === "not_served") showNotServed();
      else setProblem(booking.failedToStart);
    });

  /** The client ticked "Remind me": their yes to WhatsApp about their visits, recorded under the box's own line. */
  const switchOnReminders = async () => {
    const answer = await api.switchConsent("whatsapp_visits", true, "app_booking");
    if (answer.ok) setReminders(true);
  };

  const { payFor, letGo, changed, paying } = usePay(step, {
    dialog,
    dispatch,
    movingId,
    beforeStarting: async () => {
      if (remind && reminders !== true) await switchOnReminders();
    },
    once,
    setProblem,
  });

  // The steps before the date, each of which puts the date and the window one step later.
  const before = (picking ? 1 : 0) + (addressFirst ? 1 : 0);
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
        if (step.kind === "pay" || step.kind === "failed") letGo(step.hold);
        onClose(changed.current);
      }}
    >
      {!drawsItsOwnClose(step) && <SheetClose onClose={close}>{booking.close}</SheetClose>}
      <SheetPanel className={styles.sheet}>
        {step.kind === "loading" && <LoadingStep />}
        {step.kind === "broken" && <WaitStep text={booking.failedToStart} onClose={close} />}
        {step.kind === "service" && (
          <ServiceStep
            before={before}
            services={services}
            chosen={picked}
            recommended={recommended}
            onChoose={setPicked}
            onNext={() => {
              if (picked !== null) void pick(picked);
            }}
          />
        )}
        {step.kind === "address" && (
          <AddressStep refused={step.refused} before={before} onSaved={() => void load(wanted)} />
        )}
        {step.kind === "notServed" && <NotServedStep address={step.address} onSaved={() => void load(wanted)} />}
        <DayAndWindow
          step={step}
          before={before}
          days={days}
          wanted={wanted}
          offered={offeredDate ?? null}
          busy={busy}
          problem={problem}
          onDayTaken={() => {
            dispatch({ kind: "dayTaken" });
          }}
          onHold={() => void holdWindow()}
        />
        <HeldSteps
          step={step}
          moving={moving}
          busy={busy}
          problem={problem}
          reminders={reminders}
          remind={remind}
          onRemind={setRemind}
          onPay={(hold) => void payFor(hold)}
          onHeld={(hold) => {
            dispatch({ kind: "held", hold });
          }}
          onPickAgain={() => void load(wanted)}
          onClose={close}
        />
      </SheetPanel>
    </Sheet>
  );
}
