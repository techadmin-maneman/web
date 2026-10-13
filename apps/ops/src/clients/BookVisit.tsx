// Booking a visit for a client from the console: every kind, in a window someone is free in, with the technician ops
// choose or whoever is free. A paid visit goes out as a payment link and is booked once the client pays; anything
// else is booked at once (src/routes/ops/visits.ts). No board draws it (docs/fidelity-method.md).

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextInput } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { addDays, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import {
  api,
  type BookingWindow,
  type VisitAvailability,
  type VisitBooked,
  type VisitToBook,
  type VisitType,
} from "../api.ts";
import { clients, dispatch } from "../content.ts";
import styles from "../components/visit-dialog.module.css";
import { Choose, CoverChoice } from "./book-choices.tsx";

const copy = clients.visits.book;

/** What ops choose to book: a kind of visit, or a consultation and fit in one visit, which is a first fit. */
type Choice = keyof typeof copy.kinds;

const CHOICES = Object.keys(copy.kinds) as Choice[];

/** What a task starts the form with; the client's page starts it with a choice alone. */
export interface Prefill {
  readonly choice: Choice;
  readonly date?: string;
  readonly window?: BookingWindow;
  readonly code?: string;
  /** What the visit makes good, free: one of availability's `owed`. */
  readonly covers?: string;
}

/** How many days the API offers at a time. */
const STRIP_DAYS = 14;

const kindOf = (choice: Choice): VisitType => (choice === "one_visit" ? "first_fit" : choice);

/** A one visit's three hours do not fit in the evening. */
const fitsWindow = (choice: Choice, window: string) => choice !== "one_visit" || window !== "evening";

type Day = VisitAvailability["days"][number];
type Window = Day["windows"][number];

/** The windows of a day someone is free in, for what is being booked. */
const openWindows = (day: Day, choice: Choice): Window[] =>
  day.windows.filter((each) => each.technicians.length > 0 && fitsWindow(choice, each.window));

/** "Wed 23 Sep, 9 am": when the link closes. */
const whenOf = (instant: string) => `${shortDate(indiaDate(instant))}, ${indiaClock(instant)}`;

function payLine(choice: Choice, offered: VisitAvailability, covered: boolean): string {
  if (covered) return copy.pays.covered;
  if (choice === "one_visit") return copy.pays.oneVisit;
  if (offered.pays === "credit") return copy.pays.credit(offered.credits - 1);
  if (offered.pays === "nothing") return copy.pays.nothing;
  const price = offered.services.find((service) => service.tier === offered.service.tier)?.price.amount ?? 0;
  return copy.pays.link(rupees(price));
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
      <p className={styles.done}>{outcome}</p>
      <p className={styles.done}>{summary}</p>
      {booked.link !== null && (
        <p className={styles.done}>
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
      <p className={styles.error} role="alert">
        {copy.unreadable}
      </p>
      <Button variant="outline" size="small" className={styles.quiet} onClick={onRetry}>
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

/** The fortnight before the one shown, and the one after. */
function StripButtons(props: {
  readonly busy: boolean;
  readonly from: string | undefined;
  readonly firstDay: string | undefined;
  readonly onFrom: (from: string | undefined) => void;
}) {
  const { busy, firstDay, onFrom } = props;
  return (
    <div className={styles.days}>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        disabled={busy || props.from === undefined}
        onClick={() => {
          onFrom(firstDay === undefined ? undefined : addDays(firstDay, -STRIP_DAYS));
        }}
      >
        {copy.earlier}
      </Button>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        disabled={busy || firstDay === undefined}
        onClick={() => {
          onFrom(firstDay === undefined ? undefined : addDays(firstDay, STRIP_DAYS));
        }}
      >
        {copy.later}
      </Button>
    </div>
  );
}

/** The choices that depend on what the API offered: the service, the day, the window and the technician. */
interface Picked {
  readonly tier: string | undefined;
  readonly date: string | undefined;
  readonly window: string | undefined;
  readonly technician: string;
}

/** What the client may be booked into, from what the API offered and what ops have picked: the first of each where a pick is no longer open. */
function slotOf(offered: VisitAvailability, choice: Choice, picked: Picked) {
  const days = offered.days.filter((day) => openWindows(day, choice).length > 0);
  const day = days.find((each) => each.date === picked.date) ?? days[0];
  const windows = day === undefined ? [] : openWindows(day, choice);
  const window = windows.find((each) => each.window === picked.window) ?? windows[0];
  const technicians = window?.technicians ?? [];
  const technician = technicians.some((each) => each.id === picked.technician) ? picked.technician : "";
  return { days, day, windows, window, technicians, technician };
}

/** The fortnight's windows for what is being booked, read again as any of it changes. */
function useAvailability(clientId: string, choice: Choice, tier: string | undefined, from: string | undefined) {
  const load = useCallback(
    () =>
      api.visitAvailability({
        client: clientId,
        kind: kindOf(choice),
        ...(tier === undefined ? {} : { tier }),
        ...(from === undefined ? {} : { from }),
      }),
    [clientId, choice, tier, from],
  );
  return useLoad(load);
}

function Form({
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

  if (loaded.state === "loading") return <p className={styles.note}>{copy.loading}</p>;
  if (loaded.state === "failed") return <Unreadable onRetry={retry} />;

  const offered = loaded.value;
  const { days, day, windows, window, technicians, technician } = slotOf(offered, choice, picked);
  const firstDay = offered.days[0]?.date;
  const cover = offered.owed.some((each) => each.id === covers) ? covers : "";
  const takesCode = kindOf(choice) !== "consultation" && cover === "";

  const book = () =>
    once(async () => {
      if (day === undefined || window === undefined) return;
      setFailed(null);
      const answer = await api.bookVisit(
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
      <Choose
        label={copy.kind}
        value={choice}
        options={CHOICES.map((each) => ({ value: each, label: copy.kinds[each] }))}
        busy={busy}
        onChoose={(next) => {
          setChoice(next as Choice);
          choose({ tier: undefined });
        }}
      />
      {offered.services.length > 1 && (
        <Choose
          label={kindOf(choice) === "first_fit" ? copy.hairSystem : copy.service}
          value={offered.service.tier}
          options={offered.services.map((service) => ({ value: service.tier, label: service.name }))}
          busy={busy}
          onChoose={(tier) => {
            choose({ tier });
          }}
        />
      )}
      {day === undefined ? (
        <p className={styles.note}>{copy.noDays}</p>
      ) : (
        <>
          <Choose
            label={copy.day}
            value={day.date}
            options={days.map((each) => ({ value: each.date, label: shortDate(each.date) }))}
            busy={busy}
            onChoose={(date) => {
              choose({ date });
            }}
          />
          <Choose
            label={copy.window}
            value={window?.window ?? ""}
            options={windows.map((each) => ({
              value: each.window,
              label: `${dispatch.windows[each.window] ?? each.window}, ${each.start} to ${each.end}`,
            }))}
            busy={busy}
            onChoose={(next) => {
              choose({ window: next });
            }}
          />
          <Choose
            label={copy.technician}
            value={technician}
            options={[
              { value: "", label: copy.anyone },
              ...technicians.map((each) => ({ value: each.id, label: each.name })),
            ]}
            busy={busy}
            onChoose={(next) => {
              choose({ technician: next });
            }}
          />
        </>
      )}
      <StripButtons busy={busy} from={from} firstDay={firstDay} onFrom={setFrom} />
      <CoverChoice owed={offered.owed} value={cover} busy={busy} onChoose={setCovers} />
      {takesCode && (
        <Field className={styles.field} label={copy.code}>
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
      <p className={styles.pays}>{payLine(choice, offered, cover !== "")}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          className={styles.primary}
          type="submit"
          busy={busy}
          disabled={day === undefined || window === undefined}
        >
          {busy ? copy.booking : copy.book}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: failed })}
        </p>
      )}
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
    <Dialog
      className={styles.drawer}
      labelledBy="book-visit-title"
      canClose
      onDismiss={() => {
        onClose(booked);
      }}
    >
      <div className={styles.head}>
        <h2 className={styles.title} id="book-visit-title">
          {copy.title(name)}
        </h2>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          onClick={() => {
            onClose(booked);
          }}
        >
          {copy.close}
        </Button>
      </div>
      <div className={styles.body}>
        {booked === null ? (
          <Form clientId={clientId} prefill={prefill} onBooked={setBooked} />
        ) : (
          <Booked booked={booked} />
        )}
      </div>
    </Dialog>
  );
}
