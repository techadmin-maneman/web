// Home (boards B1 and B2): "One card, one prompt, nothing else." The next visit from FSM: a consultation as B2
// draws it, with what to expect, and any other visit as B1 draws it, with its technician (VisitCard.tsx). A
// booking's consultation, not yet in FSM, shows as B2. A visit FSM has not closed stays here until it is, so Home
// never says nothing is booked, nor offers the booking again, while one is under way.
//
// Beneath the card, B1's credit tile while there is a balance, and its one contextual prompt: an address to give,
// the replacement falling due, an invoice just issued (src/domain/home-prompt.ts).

import { fullDate, indiaDate, listMonth, shortDate } from "@maneman/web-kit/dates";
import { documentUrl, type Me } from "../api.ts";
import { BOOKING_URL, home, messages, VISIT_TYPES, visits, windowText } from "../content.ts";
import { BookButton } from "../booking/BookButton.tsx";
import type { ChangingVisit } from "../booking/ChangeSheet.tsx";
import { visitName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { AppLink, Shell } from "./Shell.tsx";
import { Actions, changingOf, hasBegun, VisitCard, whenText } from "./VisitCard.tsx";
import styles from "./home.module.css";

export function HomeScreen() {
  const { me, offline } = useSession();
  return (
    <Shell header={{ kind: "home" }} tab="/">
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
    return <Consultation date={date} when={windowText(me.consultation.window)} place={place} changing={null} />;
  }
  if (me.state === "fitted" || me.booking.types.includes("first_fit")) return <NothingNext me={me} />;
  return <NothingBooked me={me} offline={offline} />;
}

/** Board B2: the consultation card on ink, and what to expect on paper. */
function Consultation(props: {
  date: string;
  /** The window, or where a consultation that has begun stands. */
  when: string;
  place: string;
  /** Null for a booking's consultation, not yet in FSM: ops move it. */
  changing: ChangingVisit | null;
  begun?: boolean;
}) {
  const date = shortDate(props.date);
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
          <Actions what={VISIT_TYPES.consultation} date={date} changing={props.changing} begun={props.begun} />
        </div>
      </section>
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
    </>
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
    case "replacement_due": {
      const now = new Date();
      const thisMonth = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const month = listMonth(prompt.month, now.getFullYear());
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>
            {prompt.month < thisMonth ? visits.record.overdue(month) : visits.record.due(month)}
          </p>
          <a className={styles.promptLink} href={whatsappWith(messages.replacement)} rel="noopener">
            <span>{copy.involves}</span>
          </a>
        </div>
      );
    }
    case "invoice_ready":
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>{copy.invoice(visitName(prompt.type), shortDate(prompt.date))}</p>
          <a className={styles.promptLink} href={documentUrl(prompt.visit_id)} target="_blank" rel="noopener">
            <span>{copy.openInvoice}</span>
            <span className={styles.away}>{visits.detail.invoice.newTab}</span>
          </a>
        </div>
      );
  }
}

/** A client with no visit booked who may book the next: a service visit, or a first fit after the consultation. */
function NothingNext({ me }: { me: Me }) {
  const firstFit = me.booking.types.includes("first_fit");
  return (
    <section className={styles.nothing} aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <p>{home.next.none}</p>
      <BookButton
        className={styles.book}
        label={firstFit ? home.next.bookFirstFit : home.next.book}
        message={firstFit ? messages.bookFirstFit : messages.book}
      />
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
