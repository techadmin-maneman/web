// Booking a visit for a client from the console: every kind, in a window someone is free in, with the technician ops
// choose or whoever is free. A paid visit goes out as a payment link and is booked once the client pays, or, while
// online payment is off, is paid by UPI at the visit; anything else is booked at once (src/routes/ops/visits.ts). No board draws it (docs/fidelity-method.md).

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { Field, TextInput } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { type BookingWindow, type VisitAvailability, type VisitBooked, type VisitToBook } from "../api.ts";
import shared from "../components/visit-dialog.module.css";
import styles from "./book-visit.module.css";
import { CoverChoice } from "./book-choices.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { clientsApi } from "./clients-api.ts";
import { WhatIsBooked, WhenAndWho, StripButtons } from "./BookSteps.tsx";
import { copy, type Choice, kindOf, type Picked, slotOf } from "./book-slot.ts";

/** What a task starts the form with; the client's page starts it with a choice alone. */
export interface Prefill {
  readonly choice: Choice;
  readonly date?: string;
  readonly window?: BookingWindow;
  readonly code?: string;
  /** What the visit makes good, free: one of availability's `owed`. */
  readonly covers?: string;
}

/** "Wed 23 Sep, 9 am": when the link closes. */
const whenOf = (instant: string) => `${shortDate(indiaDate(instant))}, ${indiaClock(instant)}`;

function payLine(choice: Choice, offered: VisitAvailability, covered: boolean): string {
  if (covered) return copy.pays.covered;
  if (choice === "one_visit") return copy.pays.oneVisit;
  if (offered.pays === "credit") return copy.pays.credit(offered.credits - 1);
  if (offered.pays === "nothing") return copy.pays.nothing;
  const price = offered.services.find((service) => service.tier === offered.service.tier)?.price.amount ?? 0;
  return offered.pays === "at_visit" ? copy.pays.atVisit(rupees(price)) : copy.pays.link(rupees(price));
}

/** What came of the booking: booked, on its way, or a link sent and the slot held until it closes. */
function outcomeOf(booked: VisitBooked): string {
  if (booked.link !== null)
    return copy.outcomes.awaiting_payment(rupees(booked.price.amount), whenOf(booked.link.open_until));
  if (booked.outcome === "booked") return copy.outcomes.booked;
  return copy.outcomes.being_booked;
}

function Booked({ booked }: { booked: VisitBooked }) {
  const technician = booked.technician.name;
  const summary = copy.summary(booked.service.name, shortDate(booked.date), booked.window, technician);
  const outcome = outcomeOf(booked);
  return (
    <div role="status">
      <p className={shared.done}>{outcome}</p>
      <p className={shared.done}>{summary}</p>
      {booked.link !== null && (
        <p className={shared.done}>
          {copy.link}: <span className={styles.link}>{booked.link.url}</span>
        </p>
      )}
    </div>
  );
}

/** The availability could not be read; ops try again. */
function Unreadable({ onRetry }: { onRetry: () => void }) {
  return (
    <div>
      <Refusal className={shared.error} said={copy.unreadable} />
      <Button variant="outline" size="small" className={shared.quiet} onClick={onRetry}>
        {copy.retry}
      </Button>
    </div>
  );
}

/**
 * The visit as the API books it: the technician only where ops chose one, what it makes good where it makes good
 * something, else a code where the kind takes one.
 */
function visitOf(chosen: {
  clientId: string;
  choice: Choice;
  tier: string;
  date: string;
  window: BookingWindow;
  technician: string;
  code: string;
  covers: string;
}): VisitToBook {
  const takesCode = kindOf(chosen.choice) !== "consultation" && chosen.covers === "";
  return {
    client: chosen.clientId,
    kind: kindOf(chosen.choice),
    tier: chosen.tier,
    date: chosen.date,
    window: chosen.window,
    ...(chosen.technician === "" ? {} : { technician: chosen.technician }),
    ...(chosen.choice === "one_visit" ? { one_visit: true } : {}),
    ...(takesCode && chosen.code.trim() !== "" ? { code: chosen.code.trim() } : {}),
    ...(chosen.covers === "" ? {} : { covers: chosen.covers }),
  };
}

/** The fortnight's windows for what is being booked, read again as any of it changes. */
function useAvailability(clientId: string, choice: Choice, tier: string | undefined, from: string | undefined) {
  const load = useCallback(
    () =>
      clientsApi.visitAvailability({
        client: clientId,
        kind: kindOf(choice),
        ...(tier === undefined ? {} : { tier }),
        ...(from === undefined ? {} : { from }),
      }),
    [clientId, choice, tier, from],
  );
  return useLoad(load);
}

function BookingForm({
  clientId,
  prefill,
  onBooked,
}: {
  clientId: string;
  prefill: Prefill;
  onBooked: (booked: VisitBooked) => void;
}) {
  const [choice, setChoice] = useState<Choice>(prefill.choice);
  const [from, setFrom] = useState<string | undefined>(prefill.date);
  const [picked, setPicked] = useState<Picked>({
    tier: undefined,
    date: prefill.date,
    window: prefill.window,
    technician: "",
  });
  const [code, setCode] = useState(prefill.code ?? "");
  const [covers, setCovers] = useState(prefill.covers ?? "");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const [loaded, retry] = useAvailability(clientId, choice, picked.tier, from);

  const choose = (next: Partial<Picked>) => {
    setFailed(null);
    setPicked((was) => ({ ...was, ...next }));
  };

  if (loaded.state === "loading") return <p className={shared.note}>{copy.loading}</p>;
  if (loaded.state === "failed") return <Unreadable onRetry={retry} />;

  const offered = loaded.value;
  const slot = slotOf(offered, choice, picked);
  const { day, window, technician } = slot;
  const firstDay = offered.days[0]?.date;
  const cover = offered.owed.some((each) => each.id === covers) ? covers : "";
  const takesCode = kindOf(choice) !== "consultation" && cover === "";

  const book = () =>
    once(async () => {
      if (day === undefined || window === undefined) return;
      setFailed(null);
      const answer = await clientsApi.bookVisit(
        visitOf({
          clientId,
          choice,
          tier: offered.service.tier,
          date: day.date,
          window: window.window,
          technician,
          code,
          covers: cover,
        }),
      );
      if (answer.ok) onBooked(answer.body);
      else setFailed(answer.code);
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void book();
      }}
    >
      <WhatIsBooked
        choice={choice}
        offered={offered}
        busy={busy}
        onChoice={(next) => {
          setChoice(next);
          choose({ tier: undefined });
        }}
        onTier={(tier) => {
          choose({ tier });
        }}
      />
      <WhenAndWho slot={slot} busy={busy} onPick={choose} />
      <StripButtons busy={busy} from={from} firstDay={firstDay} onFrom={setFrom} />
      <CoverChoice owed={offered.owed} value={cover} busy={busy} onChoose={setCovers} />
      {takesCode && (
        <Field className={shared.field} label={copy.code}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              value={code}
              disabled={busy}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </Field>
      )}
      <p className={shared.pays}>{payLine(choice, offered, cover !== "")}</p>
      <div className={shared.actions}>
        <Button
          variant="primary"
          size="small"
          className={shared.primary}
          type="submit"
          busy={busy}
          disabled={day === undefined || window === undefined}
        >
          {busy ? copy.booking : copy.book}
        </Button>
      </div>
      {failed !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code: failed })} />}
    </form>
  );
}

/**
 * The panel ops book a visit in, for one client. Closing it says whether a visit was booked, or a link sent, so the
 * page can read the client's record again.
 */
export function BookVisit({
  clientId,
  name,
  prefill,
  onClose,
}: {
  clientId: string;
  name: string;
  prefill: Prefill;
  onClose: (booked: VisitBooked | null) => void;
}) {
  const [booked, setBooked] = useState<VisitBooked | null>(null);
  return (
    <Drawer
      titleId="book-visit-title"
      title={copy.title(name)}
      aside={
        <Button
          variant="outline"
          size="small"
          className={shared.quiet}
          onClick={() => {
            onClose(booked);
          }}
        >
          {copy.close}
        </Button>
      }
      canClose
      onDismiss={() => {
        onClose(booked);
      }}
    >
      {booked === null ? (
        <BookingForm clientId={clientId} prefill={prefill} onBooked={setBooked} />
      ) : (
        <Booked booked={booked} />
      )}
    </Drawer>
  );
}
