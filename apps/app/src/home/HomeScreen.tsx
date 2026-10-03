// Home (boards B1 and B2): "One card, one prompt, nothing else." The next visit from FSM: a consultation as B2
// draws it, with what to expect, and any other visit as B1 draws it, with its technician (VisitCard.tsx). A
// consultation from the site shows as B2 until its day has passed, saying so while it is only asked for. A visit FSM
// has not closed stays here until it is, so Home never says nothing is booked, nor offers the booking again, while one
// is under way. Nor while a visit paid for, or booked free, waits for FSM to take it: Home says it is being booked,
// and that the payment is in (ADR 0095).
//
// Beneath the card, B1's credit tile while there is a balance, its one prompt, and an invoice just issued as a line
// beneath that (src/domain/home-prompt.ts). Where the prompt offers the next visit, it is Home's one way to book it,
// with the sheet opened on its day and window; a replacement is booked here like any other visit.

import { ButtonLink } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { documentUrl, type Me } from "../api.ts";
import { BOOKING_URL, CONSULTATION_AND_FIT, home, messages, VISIT_TYPES, visits, windowText } from "../content.ts";
import { BookButton } from "../booking/BookButton.tsx";
import { BookNext } from "../booking/BookNext.tsx";
import type { ChangingVisit } from "../booking/ChangeSheet.tsx";
import { visitName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { AppLink, Shell } from "./Shell.tsx";
import { monthNow, nextVisitWords, replacementLine } from "./next-visit-words.ts";
import { Actions, changingOf, hasBegun, notingOf, VisitCard, whenText, type NotingVisit } from "./VisitCard.tsx";
import styles from "./home.module.css";

export function HomeScreen() {
  const { me, offline } = useSession();
  // A Home the phone kept from an earlier release has no invoice line at all.
  const invoice = me.invoice ?? null;
  return (
    <Shell header={{ kind: "home" }} tab="/" kept>
      <div className={styles.home}>
        <HomeBody me={me} offline={offline} />
        {me.credits !== null && <CreditTile credits={me.credits} />}
        {me.prompt !== null && <Prompt prompt={me.prompt} />}
        {invoice !== null && <InvoiceLine invoice={invoice} />}
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
  if (me.consultation !== null) return <ProposedConsultation consultation={me.consultation} />;
  if (me.being_booked !== null) return <BeingBooked booking={me.being_booked} />;
  if (me.state === "fitted" || me.booking.types.includes("first_fit")) {
    return <NothingNext promptBooks={me.prompt?.kind === "next_visit"} />;
  }
  return <NothingBooked me={me} offline={offline} />;
}

/**
 * A consultation booked on the site, or asked for there and not yet booked, before any visit is on record: ops move
 * it, and a note goes to them on WhatsApp.
 */
function ProposedConsultation({ consultation }: { consultation: NonNullable<Me["consultation"]> }) {
  return (
    <Consultation
      date={consultation.date}
      when={windowText(consultation.window)}
      place={consultation.place}
      changing={null}
      noting={null}
      requested={consultation.requested}
      oneVisit={consultation.one_visit}
    />
  );
}

/** Board B2: the consultation card on ink, and what to expect on paper until it begins. */
function Consultation(props: {
  date: string;
  /** The window, or where a consultation that has begun stands. */
  when: string;
  place: string;
  /** Null for a consultation from the site: ops move it. */
  changing: ChangingVisit | null;
  /** Null for a consultation from the site: a note goes to ops on WhatsApp. */
  noting: NotingVisit | null;
  begun?: boolean;
  /** Asked for on the site, and not yet booked. */
  requested?: boolean;
  /** The consultation and the first fit in one visit, paid for once fitted. */
  oneVisit?: boolean;
}) {
  const copy = home.consultation;
  const date = shortDate(props.date);
  const begun = props.begun === true;
  const oneVisit = props.oneVisit === true;
  return (
    <>
      <section aria-labelledby="consultation">
        <h1 className={styles.label} id="consultation">
          {oneVisit ? copy.labelOneVisit : copy.label}
        </h1>
        <div className={styles.card}>
          <p className={styles.date}>{date}</p>
          <p className={styles.window}>{props.when}</p>
          {props.place !== "" && <p className={styles.place}>{props.place}</p>}
          {!oneVisit && <p className={styles.free}>{copy.free}</p>}
          {props.requested === true && <p className={styles.free}>{copy.requested}</p>}
          {!begun && (
            <Actions
              what={oneVisit ? CONSULTATION_AND_FIT : VISIT_TYPES.consultation}
              date={date}
              changing={props.changing}
              noting={props.noting}
            />
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

type PromptOf<Kind extends NonNullable<Me["prompt"]>["kind"]> = Extract<NonNullable<Me["prompt"]>, { kind: Kind }>;

/** Board B1's one prompt: a line, and the way to act on it. */
function Prompt({ prompt }: { prompt: NonNullable<Me["prompt"]> }) {
  switch (prompt.kind) {
    case "address":
      return (
        <div className={styles.prompt}>
          <p className={styles.promptLine}>{home.prompt.address}</p>
          <AppLink className={styles.promptLink} to="/profile">
            <span>{home.prompt.addAddress}</span>
          </AppLink>
        </div>
      );
    case "next_visit":
      return <NextVisitPrompt prompt={prompt} />;
    case "replacement_due":
      return <ReplacementPrompt prompt={prompt} />;
  }
}

/** The next visit, booked on its day and window; beside a service, the replacement once that may be booked. */
function NextVisitPrompt({ prompt }: { prompt: PromptOf<"next_visit"> }) {
  const words = nextVisitWords(prompt, monthNow(new Date()));
  return (
    <div className={styles.prompt}>
      <p className={styles.promptLine}>{words.line}</p>
      <div className={styles.promptActions}>
        <BookButton
          quiet
          className={styles.promptLink}
          type={prompt.type}
          tier={prompt.tier}
          offer={{ date: prompt.date, window: prompt.window }}
          label={words.book}
          message={prompt.type === "replacement" ? messages.bookReplacement : messages.book}
        />
        {prompt.type === "replacement" && <Involves />}
        {prompt.replacement_bookable && (
          <BookButton
            quiet
            className={styles.promptLink}
            type="replacement"
            label={home.next.orReplacement}
            message={messages.bookReplacement}
          />
        )}
      </div>
    </div>
  );
}

/** The month the piece in wear falls due, never a day of it, once that month may be booked. */
function ReplacementPrompt({ prompt }: { prompt: PromptOf<"replacement_due"> }) {
  const thisMonth = monthNow(new Date());
  return (
    <div className={styles.prompt}>
      <p className={styles.promptLine}>{replacementLine(prompt.month, thisMonth)}</p>
      <div className={styles.promptActions}>
        <BookButton
          quiet
          className={styles.promptLink}
          type="replacement"
          tier={prompt.tier}
          // The strip starts with the month the piece falls due, never on a day of it.
          {...(prompt.month > thisMonth ? { from: `${prompt.month}-01` } : {})}
          label={home.prompt.bookReplacement}
          message={messages.bookReplacement}
        />
        <Involves />
      </div>
    </div>
  );
}

/** An invoice just issued: a line beneath the prompt, or the only one. */
function InvoiceLine({ invoice }: { invoice: NonNullable<Me["invoice"]> }) {
  const copy = home.prompt;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptLine}>{copy.invoice(visitName(invoice.type), shortDate(invoice.date))}</p>
      <a className={styles.promptLink} href={documentUrl(invoice.visit_id)} target="_blank" rel="noopener">
        <span>{copy.openInvoice}</span>
        <VisuallyHidden>{visits.detail.invoice.newTab}</VisuallyHidden>
      </a>
    </div>
  );
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
 * A client with no visit booked who may book the next. Where the prompt beneath offers the next visit, it is the one
 * way to book it; else the first fit, or the visit the app offers, is booked from here.
 */
function NothingNext({ promptBooks }: { promptBooks: boolean }) {
  return (
    <section className={styles.nothing} aria-labelledby="next">
      <h1 className={styles.label} id="next">
        {home.next.label}
      </h1>
      <p>{home.next.none}</p>
      {!promptBooks && <BookNext className={styles.book} offerOther={false} />}
    </section>
  );
}

/** Nothing booked yet: a consultation, in the app where self-serve booking is on, else on the public site. */
function NothingBooked({ me, offline }: { me: Me; offline: boolean }) {
  return (
    <section className={styles.nothing}>
      <h1 className={styles.nothingTitle}>{home.nothing.title}</h1>
      {me.booking.self_serve || offline ? (
        <BookButton className={styles.book} label={home.nothing.book} message={messages.book} />
      ) : (
        <ButtonLink
          variant="primary"
          size="action"
          className={styles.book}
          href={BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production}
        >
          {home.nothing.book}
        </ButtonLink>
      )}
    </section>
  );
}
