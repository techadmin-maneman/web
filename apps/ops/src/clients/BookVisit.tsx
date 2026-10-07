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

const copy = clients.visits.book;

/** What ops choose to book: a kind of visit, or a consultation and fit in one visit, which is a first fit. */
export type Choice = keyof typeof copy.kinds;

const CHOICES = Object.keys(copy.kinds) as Choice[];

/** What a task starts the form with; the client's page starts it with a choice alone. */
export interface Prefill {
  readonly choice: Choice;
  readonly date?: string;
  readonly window?: BookingWindow;
  readonly code?: string;
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

function payLine(choice: Choice, offered: VisitAvailability): string {
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

/** The choices that depend on what the API offered: the service, the day, the window and the technician. */
interface Picked {
  readonly tier: string | undefined;
  readonly date: string | undefined;
  readonly window: string | undefined;
  readonly technician: string;
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
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const load = useCallback(
    () =>
      api.visitAvailability({
        client: clientId,
        kind: kindOf(choice),
        ...(picked.tier === undefined ? {} : { tier: picked.tier }),
        ...(from === undefined ? {} : { from }),
      }),
    [clientId, choice, picked.tier, from],
  );
  const [loaded, retry] = useLoad(load);

  const choose = (next: Partial<Picked>) => {
    setFailed(null);
    setPicked((was) => ({ ...was, ...next }));
  };

  if (loaded.state === "loading") return <p className={styles.note}>{copy.loading}</p>;
  if (loaded.state === "failed") {
    return (
      <div>
        <p className={styles.error} role="alert">
          {copy.unreadable}
        </p>
        <Button variant="outline" size="small" className={styles.quiet} onClick={retry}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const offered = loaded.value;
  const days = offered.days.filter((day) => openWindows(day, choice).length > 0);
  const day = days.find((each) => each.date === picked.date) ?? days[0];
  const windows = day === undefined ? [] : openWindows(day, choice);
  const window = windows.find((each) => each.window === picked.window) ?? windows[0];
  const technicians = window?.technicians ?? [];
  const technician = technicians.some((each) => each.id === picked.technician) ? picked.technician : "";
  const firstDay = offered.days[0]?.date;
  const takesCode = kindOf(choice) !== "consultation";

  const book = () =>
    once(async () => {
      if (day === undefined || window === undefined) return;
      setFailed(null);
      const visit: VisitToBook = {
        client: clientId,
        kind: kindOf(choice),
        tier: offered.service.tier,
        date: day.date,
        window: window.window,
        ...(technician === "" ? {} : { technician }),
        ...(choice === "one_visit" ? { one_visit: true } : {}),
        ...(takesCode && code.trim() !== "" ? { code: code.trim() } : {}),
      };
      const answer = await api.bookVisit(visit);
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
      <Field className={styles.field} label={copy.kind}>
        {(control) => (
          <select
            {...control}
            className={styles.select}
            value={choice}
            disabled={busy}
            onChange={(event) => {
              setChoice(event.currentTarget.value as Choice);
              choose({ tier: undefined });
            }}
          >
            {CHOICES.map((each) => (
              <option key={each} value={each}>
                {copy.kinds[each]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {offered.services.length > 1 && (
        <Field className={styles.field} label={kindOf(choice) === "first_fit" ? copy.hairSystem : copy.service}>
          {(control) => (
            <select
              {...control}
              className={styles.select}
              value={offered.service.tier}
              disabled={busy}
              onChange={(event) => {
                choose({ tier: event.currentTarget.value });
              }}
            >
              {offered.services.map((service) => (
                <option key={service.tier} value={service.tier}>
                  {service.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {day === undefined ? (
        <p className={styles.note}>{copy.noDays}</p>
      ) : (
        <>
          <Field className={styles.field} label={copy.day}>
            {(control) => (
              <select
                {...control}
                className={styles.select}
                value={day.date}
                disabled={busy}
                onChange={(event) => {
                  choose({ date: event.currentTarget.value });
                }}
              >
                {days.map((each) => (
                  <option key={each.date} value={each.date}>
                    {shortDate(each.date)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field className={styles.field} label={copy.window}>
            {(control) => (
              <select
                {...control}
                className={styles.select}
                value={window?.window ?? ""}
                disabled={busy}
                onChange={(event) => {
                  choose({ window: event.currentTarget.value });
                }}
              >
                {windows.map((each) => (
                  <option key={each.window} value={each.window}>
                    {`${dispatch.windows[each.window] ?? each.window}, ${each.start} to ${each.end}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field className={styles.field} label={copy.technician}>
            {(control) => (
              <select
                {...control}
                className={styles.select}
                value={technician}
                disabled={busy}
                onChange={(event) => {
                  choose({ technician: event.currentTarget.value });
                }}
              >
                <option value="">{copy.anyone}</option>
                {technicians.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <div className={styles.days}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={busy || from === undefined}
          onClick={() => {
            setFrom(firstDay === undefined ? undefined : addDays(firstDay, -STRIP_DAYS));
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
            setFrom(firstDay === undefined ? undefined : addDays(firstDay, STRIP_DAYS));
          }}
        >
          {copy.later}
        </Button>
      </div>
      {takesCode && (
        <Field className={styles.field} label={copy.code}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.text}
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
      <p className={styles.pays}>{payLine(choice, offered)}</p>
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
