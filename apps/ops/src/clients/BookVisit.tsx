// Booking a visit for a client from the console, in three numbered steps (./BookSteps.tsx): every kind, a day of the
// fortnight, and a time someone is free at, with the technician ops choose or whoever is free. A paid visit goes out as a payment link and is booked once the client pays, or, while
// online payment is off, is paid by UPI at the visit; anything else is booked at once (src/routes/ops/visits.ts). No board draws it (docs/fidelity-method.md).

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { TextButton } from "@maneman/ui/TextLink";
import { Drawer } from "@maneman/ui/Drawer";
import { Field, TextInput } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { type BookingWindow, type VisitAvailability, type VisitBooked, type VisitToBook } from "../api.ts";
import shared from "./visit-dialog.module.css";
import styles from "./book-visit.module.css";
import { CoverChoice } from "./book-choices.tsx";
import { Refusal } from "@maneman/ui/Refusal";
import { clientsApi } from "./clients-api.ts";
import { WhatIsBooked, WhenAndWho, StripButtons } from "./BookSteps.tsx";
import { copy, type Choice, kindOf, type Picked, slotOf } from "./book-slot.ts";
import { CLOSE } from "../content.ts";

/** What a task starts the form with; the client's page starts it with a choice alone. */
export interface Prefill {
  readonly choice: Choice;
  readonly date?: string;
  readonly window?: BookingWindow;
  readonly code?: string;
  /** What the visit makes good, free: one of availability's `owed`. */
  readonly covers?: string;
  /** The label of the hair system in wear, which a replacement replaces. */
  readonly replacing?: string;
}

/** A replacement's "Replaces MM-ESS-0000061-R.", where the hair system in wear is known; nothing for any other visit. */
const replacesLine = (choice: Choice, prefill: Prefill): string =>
  choice === "replacement" && prefill.replacing !== undefined ? `${copy.replaces(prefill.replacing)} ` : "";

/**
 * What the form says was refused: the booking's own refusal, else a first fit for a client with no hair profile, said
 * as soon as First fit is chosen rather than once the form is filled and sent.
 */
const shownRefusal = (failed: string | null, choice: Choice, offered: VisitAvailability): string | null =>
  failed ?? (choice === "first_fit" && offered.needs_profile ? "no_profile" : null);

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
  const summary = copy.summary(booked.service.name, shortDate(booked.date), indiaClock(booked.starts_at), technician);
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
  startsAt: string;
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
    starts_at: chosen.startsAt,
    ...(chosen.technician === "" ? {} : { technician: chosen.technician }),
    ...(chosen.choice === "one_visit" ? { one_visit: true } : {}),
    ...(takesCode && chosen.code.trim() !== "" ? { code: chosen.code.trim() } : {}),
    ...(chosen.covers === "" ? {} : { covers: chosen.covers }),
  };
}

/**
 * The days without each start a booking was refused at in this panel: offered on the plan's
 * estimate of the drives, then found by the drives themselves not to fit, it would only be refused again.
 */
function withoutRefused(offered: VisitAvailability, refused: ReadonlySet<string>): VisitAvailability {
  if (refused.size === 0) return offered;
  return {
    ...offered,
    days: offered.days.map((day) => ({
      ...day,
      starts: day.starts.filter((start) => !refused.has(start.starts_at)),
    })),
  };
}

/** The starts a booking was refused at in this panel; `refuse` shuts one and reads the days afresh. */
function useRefusedStarts(retry: () => void) {
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const refuse = (startsAt: string) => {
    setRefused((was) => new Set([...was, startsAt]));
    retry();
  };
  return [refused, refuse] as const;
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

/** A discount code for the visit, where it takes one. */
function CodeBox({ code, busy, onCode }: { code: string; busy: boolean; onCode: (code: string) => void }) {
  return (
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
            onCode(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** The panel's foot: what is paid, and Book, which names the day and time once a time is chosen. */
function BookFoot(props: {
  line: string;
  day: string | undefined;
  chosen: string | null;
  busy: boolean;
  blocked: boolean;
}) {
  const { day, chosen } = props;
  const label =
    day === undefined || chosen === null ? copy.chooseTime : copy.bookAt(shortDate(day), indiaClock(chosen));
  return (
    <div className={shared.foot}>
      <p className={shared.pays}>{props.line}</p>
      <Button
        variant="primary"
        size="small"
        type="submit"
        busy={props.busy}
        disabled={chosen === null || props.blocked}
      >
        {props.busy ? copy.booking : label}
      </Button>
    </div>
  );
}

/** The free remake chosen, while it is still owed, and whether a code may be given: never with one, nor for a consultation. */
function remakeAndCode(offered: VisitAvailability, covers: string, choice: Choice) {
  const cover = offered.owed.some((each) => each.id === covers) ? covers : "";
  return { cover, takesCode: kindOf(choice) !== "consultation" && cover === "" };
}

/** What ops have asked of the booking so far: the kind, the fortnight, the slot picked, a code and a free remake. */
function useAsked(prefill: Prefill) {
  const [choice, setChoice] = useState<Choice>(prefill.choice);
  const [from, setFrom] = useState<string | undefined>(prefill.date);
  const asked = { date: prefill.date, window: prefill.window };
  const [picked, setPicked] = useState<Picked>({ tier: undefined, ...asked, start: undefined, technician: "" });
  const [code, setCode] = useState(prefill.code ?? "");
  const [covers, setCovers] = useState(prefill.covers ?? "");
  return { choice, setChoice, from, setFrom, picked, setPicked, code, setCode, covers, setCovers };
}

/** A discount code's box, once asked for or handed on; until then, the way to ask for it. */
function CodeOrAdd(props: { code: string; given: boolean; busy: boolean; onCode: (code: string) => void }) {
  const [open, setOpen] = useState(props.given);
  if (open) return <CodeBox code={props.code} busy={props.busy} onCode={props.onCode} />;
  return (
    <TextButton
      compact
      onClick={() => {
        setOpen(true);
      }}
    >
      {copy.addCode}
    </TextButton>
  );
}

/** The panel while it books: the three steps, what it may make good, a code, and its foot. */
function BookingDrawer({
  clientId,
  name,
  prefill,
  onBooked,
  onDismiss,
}: {
  clientId: string;
  name: string;
  prefill: Prefill;
  onBooked: (booked: VisitBooked) => void;
  onDismiss: () => void;
}) {
  const { choice, setChoice, from, setFrom, picked, setPicked, code, setCode, covers, setCovers } = useAsked(prefill);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const [loaded, retry] = useAvailability(clientId, choice, picked.tier, from);
  const [refusedStarts, refuseStart] = useRefusedStarts(retry);
  const frame = { titleId: "book-visit-title", title: copy.title(name), close: CLOSE, onDismiss };

  const choose = (next: Partial<Picked>) => {
    setFailed(null);
    setPicked((was) => ({ ...was, ...next }));
  };
  if (loaded.state !== "loaded")
    return (
      <Drawer {...frame}>
        {loaded.state === "failed" ? <Unreadable onRetry={retry} /> : <p className={shared.note}>{copy.loading}</p>}
      </Drawer>
    );

  const offered = withoutRefused(loaded.value, refusedStarts);
  const slot = slotOf(offered, picked);
  const { day, start, window, technician } = slot;
  // A time is chosen once ops pick one, or a window was asked for, as Tasks hands one on.
  const chosen = picked.start !== undefined || picked.window !== undefined ? (start?.starts_at ?? null) : null;
  const { cover, takesCode } = remakeAndCode(offered, covers, choice);
  const refused = shownRefusal(failed, choice, offered);

  const book = () =>
    once(async () => {
      if (day === undefined || start === undefined || window === undefined || chosen === null) return;
      setFailed(null);
      const answer = await clientsApi.bookVisit(
        visitOf({
          clientId,
          choice,
          tier: offered.service.tier,
          date: day.date,
          window,
          startsAt: start.starts_at,
          technician,
          code,
          covers: cover,
        }),
      );
      if (answer.ok) onBooked(answer.body);
      // A start refused as taken is not offered again here, and the days are read afresh for what is free now.
      else if (answer.code === "taken") {
        refuseStart(start.starts_at);
        setPicked((was) => ({ ...was, start: undefined, window: undefined, technician: "" }));
      }
      setFailed(answer.ok ? null : answer.code);
    });

  return (
    <Drawer
      {...frame}
      onSubmit={(event) => {
        event.preventDefault();
        void book();
      }}
      foot={
        <BookFoot
          line={replacesLine(choice, prefill) + payLine(choice, offered, cover !== "")}
          day={day?.date}
          chosen={chosen}
          busy={busy}
          blocked={refused === "no_profile"}
        />
      }
    >
      <WhatIsBooked
        choice={choice}
        offered={offered}
        busy={busy}
        onChoice={(next) => {
          setChoice(next);
          choose({ tier: undefined, start: undefined });
        }}
        onTier={(tier) => {
          choose({ tier });
        }}
      />
      <WhenAndWho offered={offered} slot={slot} chosen={chosen} busy={busy} onPick={choose} />
      <StripButtons busy={busy} from={from} firstDay={offered.days[0]?.date} onFrom={setFrom} />
      <CoverChoice owed={offered.owed} value={cover} busy={busy} onChoose={setCovers} />
      {takesCode && <CodeOrAdd code={code} given={prefill.code !== undefined} busy={busy} onCode={setCode} />}
      {refused !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code: refused })} />}
    </Drawer>
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
  if (booked === null)
    return (
      <BookingDrawer
        clientId={clientId}
        name={name}
        prefill={prefill}
        onBooked={setBooked}
        onDismiss={() => {
          onClose(null);
        }}
      />
    );
  return (
    <Drawer
      titleId="book-visit-title"
      title={copy.title(name)}
      close={CLOSE}
      onDismiss={() => {
        onClose(booked);
      }}
    >
      <Booked booked={booked} />
    </Drawer>
  );
}
