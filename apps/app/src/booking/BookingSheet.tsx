// Booking or moving a visit in the app (docs/decisions/0045-self-serve-booking.md), on the design's full screen: the
// service, the address where none is saved, the day and time, then the review and paying through Razorpay Checkout.
// The steps are ./flow.ts's, the hold's clocks ./hold-clocks.ts's, and the day it opens on
// docs/decisions/0086-the-next-visit-is-offered.md's.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { classes } from "@maneman/ui/classes";
import { Sheet, SheetPanel } from "@maneman/ui/Sheet";
import { addDays, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  api,
  type Address,
  type Availability,
  type BookableType,
  type BookingWindow,
  type Hold,
  type Me,
  type MoveTerms,
  type OfferedService,
  type Wanted,
} from "../api.ts";
import { booking } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { useSession } from "../session.ts";
import { nextStep, type Step } from "./flow.ts";
import { hasLaterDays } from "./days.ts";
import type { Days } from "./useDays.ts";
import { useSheetData } from "./useSheetData.ts";
import { stepsBack, useHoldStart } from "./sheet-actions.ts";
import { usePay } from "./usePay.ts";
import { AddressStep, NotServedStep } from "./steps/AddressStep.tsx";
import { ConfirmedStep, ExpiredStep, WaitStep } from "./steps/OutcomeSteps.tsx";
import { LoadingStep, moveLine, stepOf, TITLE_ID } from "./steps/shared.tsx";
import { PayStep } from "./steps/PayStep.tsx";
import { ServiceStep, type Recommended } from "./steps/ServiceStep.tsx";
import { TierStep } from "./steps/TierStep.tsx";
import { WhenStep } from "./steps/WhenStep.tsx";
import styles from "./booking.module.css";

/**
 * What a sheet with nothing to pick books: the one service open to the client, or else the kind's standard one;
 * for a move, its visit's own, which the API knows.
 */
function onlyOne(type: BookableType, services: readonly OfferedService[], moving: MoveTerms | undefined): Wanted {
  const [only] = services;
  return moving === undefined && only !== undefined ? { type: only.type, tier: only.tier } : { type };
}

/** The day and window a visit is offered on: the sheet opens on its first open start in that window. */
export interface Offered {
  readonly date: string;
  readonly window: BookingWindow | null;
}

/** How many days before the day offered the strip starts, so the week before it is there to scroll back to. */
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
  /** The day and window the visit is offered on, chosen where they are free. */
  offer?: Offered;
  /** `changed`: money moved or a visit was booked, so Home is out of date. */
  onClose: (changed: boolean) => void;
}

/** The day and time step's title: a move's, a first fit's or replacement's, or any other visit's. */
function whenTitle(type: BookableType, moving: MoveTerms | undefined): string {
  if (moving !== undefined) return booking.when.titleMove;
  return type === "first_fit" || type === "replacement" ? booking.when.titleDate : booking.when.title;
}

/**
 * Why a replacement's days open later than its own first day, the later of tomorrow and the day it opens: its hair
 * system not in stock in the client's size, the days opening once one can be there (ADR 0253, decision 6).
 */
export function stockNoteOf(availability: Availability, worn: Me["hair_system"]): string | null {
  if (availability.type !== "replacement") return null;
  const tomorrow = addDays(todayInIndia(Date.now()), 1);
  const opens = worn === null || worn.replacement_opens_on < tomorrow ? tomorrow : worn.replacement_opens_on;
  if (availability.opens <= opens) return null;
  return booking.when.notInStock(availability.service.name, shortDate(availability.opens));
}

/** The day, and the start on it, which is held as the client goes on. */
function DayAndTime(props: {
  days: Days;
  before: number;
  moving: MoveTerms | undefined;
  wanted: Wanted | null;
  offered: string | null;
  busy: boolean;
  problem: string | null;
  onBack: (() => void) | undefined;
  onClose: () => void;
  onHold: () => void;
}) {
  const { days, moving } = props;
  const { me } = useSession();
  const { availability } = days;
  if (availability === null) return null;
  const later = hasLaterDays(availability)
    ? {
        busy: days.laterAsk === "busy",
        failed: days.laterAsk === "failed",
        onShow: () => void days.showLater(props.wanted),
      }
    : null;
  return (
    <WhenStep
      title={whenTitle(availability.type, moving)}
      step={stepOf(1, props.before)}
      onBack={props.onBack}
      onClose={props.onClose}
      availability={availability}
      moveNotice={moving === undefined ? null : { line: moveLine(moving), charged: moving.cost !== "free" }}
      stockNote={moving === undefined ? stockNoteOf(availability, me.hair_system) : null}
      offered={props.offered}
      date={days.date}
      chosenStart={days.chosenStart}
      later={later}
      busy={props.busy}
      problem={props.problem}
      onChooseDate={days.chooseDate}
      onChooseStart={days.setChosenStart}
      onEarliest={days.chooseStartOn}
      onNext={props.onHold}
    />
  );
}

/**
 * What the steps once a start is held do: pay, step back or change the address, pick again, or close. Stepping back
 * or changing the address are offered only while the hold may be left (`leavable`): not while Pay is starting, nor
 * once the hold has a Razorpay order, which the API would hand back unchanged for the next time picked.
 */
interface HeldActions {
  readonly onRemind: (remind: boolean) => void;
  readonly onPay: (hold: Hold) => void;
  readonly onHeld: (hold: Hold) => void;
  readonly leavable: (hold: Hold) => boolean;
  readonly onBack: (hold: Hold) => void;
  readonly onChangeAddress: (hold: Hold) => void;
  readonly onPickAgain: () => void;
  readonly onClose: () => void;
}

/** The steps once a start is held: the review and paying for it, and what came of that. */
function HeldSteps(
  props: HeldActions & {
    step: Step;
    before: number;
    moving: MoveTerms | undefined;
    address: Address | null;
    busy: boolean;
    problem: string | null;
    reminders: boolean | null;
    remind: boolean;
    /** The hold whose Checkout was closed unpaid, said on the review. */
    dismissedOn: string | null;
  },
) {
  const { step, reminders } = props;
  switch (step.kind) {
    // The same review, a failed payment said at its head, so what the client ticked stays ticked.
    case "pay":
    case "failed":
      return (
        <PayStep
          hold={step.hold}
          moving={props.moving}
          address={props.address}
          failed={step.kind === "failed"}
          unfinished={step.kind === "pay" && props.dismissedOn === step.hold.id}
          step={stepOf(2, props.before)}
          busy={props.busy}
          problem={props.problem}
          askToRemind={reminders !== true}
          remind={props.remind}
          onRemind={props.onRemind}
          onPay={() => {
            props.onPay(step.hold);
          }}
          onHold={props.onHeld}
          onBack={
            props.leavable(step.hold)
              ? () => {
                  props.onBack(step.hold);
                }
              : undefined
          }
          onClose={props.onClose}
          onChangeAddress={
            props.leavable(step.hold)
              ? () => {
                  props.onChangeAddress(step.hold);
                }
              : undefined
          }
        />
      );
    case "expired":
      return <ExpiredStep onPickAgain={props.onPickAgain} onClose={props.onClose} />;
    case "confirming":
      return step.paidIn === true ? (
        <WaitStep title={booking.paidIn} waiting onClose={props.onClose} />
      ) : (
        <WaitStep
          title={step.hold.price.amount > 0 ? booking.confirming.paid : booking.confirming.free}
          line={booking.confirming.line}
          waiting
          onClose={props.onClose}
        />
      );
    case "confirmed":
      return (
        <ConfirmedStep
          hold={step.hold}
          moving={props.moving}
          address={props.address}
          reminded={reminders === true}
          onDone={props.onClose}
        />
      );
    case "slow":
      return (
        <WaitStep
          title={booking.slow.title}
          line={step.paid || reminders === true ? booking.slow.line : booking.slow.quiet}
          onClose={props.onClose}
        />
      );
    case "refunded":
      return <WaitStep title={booking.refunded.title} line={booking.refunded.line} onClose={props.onClose} />;
    // The steps before a start is held, which the sheet draws itself.
    case "loading":
    case "broken":
    case "service":
    case "address":
    case "notServed":
    case "when":
      return null;
  }
}

/** The steps before the days: loading, the service, the address, or the answer that it is not served. */
function BeforeTheDays(props: {
  step: Step;
  before: number;
  services: readonly OfferedService[];
  picked: OfferedService | null;
  recommended: Recommended | undefined;
  address: Address | null;
  onPick: (service: OfferedService) => void;
  onPicked: () => void;
  onAddressSaved: () => void;
  onClose: () => void;
}) {
  const { step } = props;
  switch (step.kind) {
    case "loading":
      return <LoadingStep onClose={props.onClose} />;
    case "broken":
      return <WaitStep title={booking.failedToStart} onClose={props.onClose} />;
    case "service":
      // A replacement's choice is of its hair system, kept or changed; any other kind's, of its visit.
      if (props.services.every((service) => service.type === "replacement")) {
        return (
          <TierStep
            step={{ at: 1, of: stepOf(0, props.before).of }}
            services={props.services}
            chosen={props.picked}
            onChoose={props.onPick}
            onNext={props.onPicked}
            onClose={props.onClose}
          />
        );
      }
      return (
        <ServiceStep
          step={{ at: 1, of: stepOf(0, props.before).of }}
          services={props.services}
          chosen={props.picked}
          recommended={props.recommended}
          onChoose={props.onPick}
          onNext={props.onPicked}
          onClose={props.onClose}
        />
      );
    case "address":
      return (
        <AddressStep
          refused={step.refused}
          address={step.changing === true ? props.address : null}
          step={step.changing === true ? undefined : stepOf(0, props.before)}
          onSaved={props.onAddressSaved}
          onClose={props.onClose}
        />
      );
    case "notServed":
      return <NotServedStep address={step.address} onSaved={props.onAddressSaved} onClose={props.onClose} />;
    // The day and time, and the steps once a start is held, which the sheet draws apart.
    case "when":
    case "pay":
    case "failed":
    case "expired":
    case "confirming":
    case "confirmed":
    case "slow":
    case "refunded":
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
  const { days, reminders, setReminders, address, addressFirst, askForAddress, showNotServed, load, pick } = sheet;

  // Each step's heading takes the focus the last step's button took with it, as it does when "Later dates" goes with
  // the last of them.
  const daysShown = days.availability?.days.length;
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step.kind, daysShown]);

  const close = () => dialog.current?.close();

  const holdStart = useHoldStart({ once, wanted, days, movingId, setProblem, dispatch, askForAddress, showNotServed });

  /** The client ticked "Remind me": their yes to WhatsApp about their visits, recorded under the box's own line. */
  const switchOnReminders = async () => {
    const answer = await api.switchConsent("whatsapp_visits", true, "app_booking");
    if (answer.ok) setReminders(true);
  };

  const { payFor, letGo, changed, paying, hasOrder, dismissedOn } = usePay(step, {
    dialog,
    dispatch,
    movingId,
    beforeStarting: async () => {
      if (remind && reminders !== true) await switchOnReminders();
    },
    once,
    setProblem,
  });

  const { leaveReview, stepBack } = stepsBack({ letGo, setProblem, dispatch });

  // The steps before the day and time, each of which puts them, and the review, one step later.
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
      <SheetPanel className={classes(styles.sheet, styles.screen)}>
        <BeforeTheDays
          step={step}
          before={before}
          services={services}
          picked={picked}
          recommended={recommended}
          address={address}
          onPick={setPicked}
          onPicked={() => {
            setProblem(null);
            if (picked !== null) void pick(picked);
          }}
          onAddressSaved={() => void load(wanted)}
          onClose={close}
        />
        {step.kind === "when" && (
          <DayAndTime
            days={days}
            before={before}
            moving={moving}
            wanted={wanted}
            offered={offeredDate ?? null}
            busy={busy}
            problem={problem}
            onBack={picking ? stepBack : undefined}
            onClose={close}
            onHold={() => void holdStart()}
          />
        )}
        <HeldSteps
          step={step}
          before={before}
          moving={moving}
          address={address}
          busy={busy}
          problem={problem}
          reminders={reminders}
          remind={remind}
          dismissedOn={dismissedOn}
          onRemind={setRemind}
          onPay={(hold) => void payFor(hold)}
          onHeld={(hold) => {
            dispatch({ kind: "held", hold });
          }}
          leavable={(hold) => !busy && !hasOrder(hold)}
          onBack={(hold) => {
            leaveReview(hold, { kind: "back" });
          }}
          onChangeAddress={(hold) => {
            leaveReview(hold, { kind: "changeAddress" });
          }}
          onPickAgain={() => void load(wanted)}
          onClose={close}
        />
      </SheetPanel>
    </Sheet>
  );
}
