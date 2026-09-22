// Home (boards B1 and B2). The next visit from FSM: a consultation as B2
// draws it, with what to expect, and any other visit as B1 draws it, with its
// technician. A Phase 1 booking's consultation, not yet in FSM, shows as B2.
// Until self-serve booking is on, Reschedule, Add a note and Book open
// WhatsApp to ops with a message ready (docs/prompts/phase2-backend.md,
// "Booking"). Offline, booking and rescheduling wait for the connection (B3).
// B1's credit tile and contextual prompt arrive with the credits (P2-M3) and
// the pieces (P2-M4).

import { shortDate } from "@maneman/web-kit/dates";
import type { Me, VisitSummary } from "../api.ts";
import { BOOKING_URL, home, messages, PHASE1_WINDOWS, VISIT_TYPES, windowText, type WindowLabel } from "../content.ts";
import { firstName, visitName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { Shell } from "./Shell.tsx";
import styles from "./home.module.css";

export function HomeScreen() {
  const { me, offline } = useSession();
  return (
    <Shell header={{ kind: "home" }} tab="/">
      <div className={styles.home}>
        <HomeBody me={me} offline={offline} />
      </div>
    </Shell>
  );
}

function HomeBody({ me, offline }: { me: Me; offline: boolean }) {
  const visit = me.next_visit;
  if (visit?.type === "consultation") {
    return <Consultation date={visit.date} window={visit.window_label} place={visit.place} offline={offline} />;
  }
  if (visit !== null) return <NextVisit visit={visit} offline={offline} />;
  if (me.consultation !== null) {
    const { date, window_label, place } = me.consultation;
    return (
      <Consultation date={date} window={PHASE1_WINDOWS[window_label] ?? "morning"} place={place} offline={offline} />
    );
  }
  return me.state === "fitted" ? <NothingNext offline={offline} /> : <NothingBooked offline={offline} />;
}

function Actions({ what, date, offline }: { what: string; date: string; offline: boolean }) {
  return (
    <div className={styles.actions}>
      {offline ? (
        <button className={styles.action} type="button" disabled>
          {home.reschedule}
        </button>
      ) : (
        <a className={styles.action} href={whatsappWith(messages.reschedule(what, date))} rel="noopener">
          {home.reschedule}
        </a>
      )}
      <a className={styles.action} href={whatsappWith(messages.note(what, date))} rel="noopener">
        {home.note}
      </a>
    </div>
  );
}

/** Board B2: the consultation card on ink, and what to expect on paper. */
function Consultation(props: { date: string; window: WindowLabel; place: string; offline: boolean }) {
  const date = shortDate(props.date);
  return (
    <>
      <section aria-labelledby="consultation">
        <h1 className={styles.label} id="consultation">
          {home.consultation.label}
        </h1>
        <div className={styles.card}>
          <p className={styles.date}>{date}</p>
          <p className={styles.window}>{windowText(props.window)}</p>
          {props.place !== "" && <p className={styles.place}>{props.place}</p>}
          <p className={styles.free}>{home.consultation.free}</p>
          <Actions what={VISIT_TYPES.consultation} date={date} offline={props.offline} />
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

/** Board B1: the next visit, with its technician. */
function NextVisit({ visit, offline }: { visit: VisitSummary; offline: boolean }) {
  const date = shortDate(visit.date);
  const what = visitName(visit.type);
  return (
    <section aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <div className={styles.card}>
        <p className={styles.date}>{date}</p>
        <p className={styles.window}>{windowText(visit.window_label)}</p>
        <div className={styles.technician}>
          {visit.technician !== null && (
            <span className={styles.initials} aria-hidden="true">
              {visit.technician.initials}
            </span>
          )}
          <div>
            {visit.technician !== null && <p className={styles.who}>{firstName(visit.technician.name)}</p>}
            <p className={styles.length}>{home.next.length(what, visit.length_minutes)}</p>
          </div>
        </div>
        {visit.place !== "" && <p className={styles.place}>{visit.place}</p>}
        <Actions what={what} date={date} offline={offline} />
      </div>
    </section>
  );
}

/** A fitted client with no visit booked: a way to book the next. */
function NothingNext({ offline }: { offline: boolean }) {
  return (
    <section className={styles.nothing} aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <p>{home.next.none}</p>
      {offline ? (
        <button className={styles.book} type="button" disabled>
          {home.next.book}
        </button>
      ) : (
        <a className={styles.book} href={whatsappWith(messages.book)} rel="noopener">
          {home.next.book}
        </a>
      )}
    </section>
  );
}

function NothingBooked({ offline }: { offline: boolean }) {
  return (
    <section className={styles.nothing}>
      <h1 className={styles.nothingTitle}>{home.nothing.title}</h1>
      <p>{home.nothing.body}</p>
      {offline ? (
        <button className={styles.book} type="button" disabled>
          {home.nothing.book}
        </button>
      ) : (
        <a className={styles.book} href={BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production}>
          {home.nothing.book}
        </a>
      )}
    </section>
  );
}
