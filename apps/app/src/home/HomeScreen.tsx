// Home (boards B1 and B2): "One card, one prompt, nothing else." The next visit from FSM: a consultation as B2
// draws it, with what to expect, and any other visit as B1 draws it, with its technician (VisitCard.tsx). A
// booking's consultation, not yet in FSM, shows as B2. A visit FSM has not closed stays here until it is, so Home
// never says nothing is booked, nor offers the booking again, while one is under way. Nor while a visit paid for, or
// booked free, waits for FSM to take it: Home says it is being booked, and that the payment is in (ADR 0095).
//
// Beneath the card, B1's credit tile while there is a balance, and its one contextual prompt, in the owner's order:
// an address to give, the next service due and not booked, the replacement falling due, an invoice just issued
// (src/domain/home-prompt.ts). The next visit opens the booking sheet with its day and window chosen, and a
// replacement is booked here like any other visit, with a page on what it involves (ADR 0086).

import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaDate, listMonth, shortDate } from "@maneman/web-kit/dates";
import { documentUrl, type Me } from "../api.ts";
import { BOOKING_URL, home, messages, VISIT_TYPES, visits, WINDOW_NAMES, windowText } from "../content.ts";
import { BookButton } from "../booking/BookButton.tsx";
import { BookNext } from "../booking/BookNext.tsx";
import type { ChangingVisit } from "../booking/ChangeSheet.tsx";
import { visitName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { AppLink, Shell } from "./Shell.tsx";
import { Actions, changingOf, hasBegun, notingOf, VisitCard, whenText, type NotingVisit } from "./VisitCard.tsx";
import styles from "./home.module.css";

export function HomeScreen() {
  const { me, offline } = useSession();
  return (
    <Shell header={{ kind: "home" }} tab="/" kept>
      <div className={styles.home}>
        <HomeBody me={me} offline={offline} />
        {me.credits !== null && <CreditTile credits={me.credits} />}
        {me.prompt !== null && <Prompt prompt={me.prompt} />}
      </div>
    </Shell>
  );
}

function HomeBody({ me, offline }: { me: Me; offline: boolean }) {
  const visit = me.next_visit;
  if (visit?.type === "consultation") {
    return (
      <Consultation
        date={visit.date}
        when={whenText(visit)}
        place={visit.place}
        changing={changingOf(visit, VISIT_TYPES.consultation)}
        noting={notingOf(visit)}
        begun={hasBegun(visit)}
      />
    );
  }
  if (visit !== null) {
    return (
      <section aria-labelledby="next">
        <h1 className={styles.label} id="next">
          {home.next.label}
        </h1>
        <VisitCard visit={visit} />
      </section>
    );
  }
  if (me.consultation !== null) {
    const { date, place } = me.consultation;
    return (
      <Consultation date={date} when={windowText(me.consultation.window)} place={place} changing={null} noting={null} />
    );
  }
  if (me.being_booked !== null) return <BeingBooked booking={me.being_booked} />;
  if (me.state === "fitted" || me.booking.types.includes("first_fit")) return <NothingNext />;
  return <NothingBooked me={me} offline={offline} />;
}

/** Board B2: the consultation card on ink, and what to expect on paper until it begins. */
function Consultation(props: {
  date: string;
  /** The window, or where a consultation that has begun stands. */
  when: string;
  place: string;
  /** Null for a booking's consultation, not yet in FSM: ops move it. */
  changing: ChangingVisit | null;
  /** Null for a booking's consultation, not yet in FSM: a note goes to ops on WhatsApp. */
  noting: NotingVisit | null;
  begun?: boolean;
}) {
  const date = shortDate(props.date);
  const begun = props.begun === true;
  return (
    <>
      <section aria-labelledby="consultation">
        <h1 className={styles.label} id="consultation">
          {home.consultation.label}
        </h1>
        <div className={styles.card}>
          <p className={styles.date}>{date}</p>
          <p className={styles.window}>{props.when}</p>
          {props.place !== "" && <p className={styles.place}>{props.place}</p>}
          <p className={styles.free}>{home.consultation.free}</p>
          {!begun && (
            <Actions what={VISIT_TYPES.consultation} date={date} changing={props.changing} noting={props.noting} />
          )}
        </div>
      </section>
      {!begun && <WhatToExpect />}
    </>
  );
}

function WhatToExpect() {
  return (
    <section className={styles.expect} aria-labelledby="expect">
      <h2 className={styles.label} id="expect">
        {home.expect.label}
      </h2>
      <ol className={styles.steps}>
        {home.expect.steps.map((step, index) => (
          <li key={step} className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A visit paid for, or booked free, that FSM does not have yet: never said to be booked, nor its money gone. */
function BeingBooked({ booking }: { booking: NonNullable<Me["being_booked"]> }) {
  const copy = home.beingBooked;
  return (
    <section aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <div className={styles.card}>
        <p className={styles.date}>{shortDate(booking.date)}</p>
        <p className={styles.window}>{windowText(booking.window)}</p>
        <p className={styles.place}>{VISIT_TYPES[booking.type]}</p>
        <p className={styles.free}>{booking.paid ? copy.paid : copy.free}</p>
        <p className={styles.free}>{copy.told}</p>
      </div>
    </section>
  );
}

/** Board B1's credit tile: the balance, and when the soonest of it expires. */
function CreditTile({ credits }: { credits: NonNullable<Me["credits"]> }) {
  const expiry = credits.earliest_expiry;
  return (
    <div className={styles.credits}>
      <div>
        <p className={styles.creditsLabel}>{home.credits.count(credits.visits)}</p>
        {expiry !== null && <p className={styles.creditsExpiry}>{home.credits.expire(fullDate(indiaDate(expiry)))}</p>}
      </div>
      <p className={styles.creditsCount} aria-hidden="true">
        {credits.visits}
      </p>
    </div>
  );
}

/** Board B1's one prompt: a line, and the way to act on it. */
function Prompt({ prompt }: { prompt: NonNullable<Me["prompt"]> }) {
  const copy = home.prompt;
  switch (prompt.kind) {
    case "address":
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>{copy.address}</p>
          <AppLink className={styles.promptLink} to="/profile">
            <span>{copy.addAddress}</span>
          </AppLink>
        </div>
      );
    case "next_visit":
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>
            {copy.nextVisit(
              VISIT_TYPES[prompt.type],
              shortDate(prompt.date),
              prompt.window === null ? null : WINDOW_NAMES[prompt.window],
            )}
          </p>
          <div className={styles.promptActions}>
            <BookButton
              quiet
              className={styles.promptLink}
              type={prompt.type}
              tier={prompt.tier}
              offer={{ date: prompt.date, window: prompt.window }}
              label={copy.bookNext}
              message={prompt.type === "replacement" ? messages.bookReplacement : messages.book}
            />
            {prompt.type === "replacement" && <Involves />}
          </div>
        </div>
      );
    case "replacement_due": {
      const now = new Date();
      const thisMonth = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const month = listMonth(prompt.month, now.getFullYear());
      const firstDay = `${prompt.month}-01`;
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>
            {prompt.month < thisMonth ? visits.record.overdue(month) : visits.record.due(month)}
          </p>
          <div className={styles.promptActions}>
            {prompt.bookable && (
              <BookButton
                quiet
                className={styles.promptLink}
                type="replacement"
                tier={prompt.tier}
                // The strip starts with the month the piece falls due, never on a day of it (ADR 0059).
                {...(prompt.month > thisMonth ? { from: firstDay } : {})}
                label={copy.bookReplacement}
                message={messages.bookReplacement}
              />
            )}
            <Involves />
          </div>
        </div>
      );
    }
    case "invoice_ready":
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>{copy.invoice(visitName(prompt.type), shortDate(prompt.date))}</p>
          <a className={styles.promptLink} href={documentUrl(prompt.visit_id)} target="_blank" rel="noopener">
            <span>{copy.openInvoice}</span>
            <VisuallyHidden>{visits.detail.invoice.newTab}</VisuallyHidden>
          </a>
        </div>
      );
  }
}

/** "See what that involves": the app's own page on a replacement, in place of a WhatsApp message to us. */
function Involves() {
  return (
    <AppLink className={styles.promptLink} to="/replacement">
      <span>{home.prompt.involves}</span>
    </AppLink>
  );
}

/**
 * A client with no visit booked who may book the next: a first fit after the consultation, or a service visit or a
 * replacement, in the sheet with the day and window the app offers chosen (ADR 0086).
 */
function NothingNext() {
  return (
    <section className={styles.nothing} aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <p>{home.next.none}</p>
      <BookNext className={styles.book} otherClassName={styles.promptLink} />
    </section>
  );
}

/** Nothing booked yet: a consultation, in the app where self-serve booking is on, else on the public site. */
function NothingBooked({ me, offline }: { me: Me; offline: boolean }) {
  return (
    <section className={styles.nothing}>
      <h1 className={styles.nothingTitle}>{home.nothing.title}</h1>
      <p>{home.nothing.body}</p>
      {me.booking.self_serve || offline ? (
        <BookButton className={styles.book} label={home.nothing.book} message={messages.book} />
      ) : (
        <a className={styles.book} href={BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production}>
          {home.nothing.book}
        </a>
      )}
    </section>
  );
}
