// Home: "One card, one prompt, nothing else." The next visit: a consultation as the design draws it,
// with what to expect, and any other visit as Home draws it, with its technician (VisitCard.tsx). A consultation from
// the site shows as the design's consultation card until its day has passed, saying so while it is only asked for. A visit not yet closed stays
// here until it is, so Home never says nothing is booked, nor offers the booking again, while one is under way. Nor
// while a visit paid for, or booked free, waits to be booked: Home says it is being booked, and that the payment is in
// (ADR 0068). A consultation and fit in one visit says what it costs once fitted, and has its own steps to expect;
// one booked on /book shows as booked before it is a visit, as the site's consultation does.
//
// Beneath the card, a one visit's payment while the client owes it, the credit tile while there is a balance, its one prompt, and an invoice just issued as a line
// beneath that (src/domain/clients/home-prompt.ts). Where the prompt offers the next visit, it is Home's one way to book it,
// with the sheet opened on its day and window; a replacement is booked here like any other visit.

import { BookButton, BookNext, type ChangingVisit } from "../booking/index.ts";
import { capsLook } from "@maneman/ui/Caps";
import { ButtonLink } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaDate, listDate, monthInIndia, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { documentUrl, type Me, type OneVisitPrice } from "../api.ts";
import { BOOKING_URL, home, messages, ONE_VISIT, VISIT_TYPES, visits, windowText } from "../content.ts";
import { apiNow } from "../lib/clock.ts";
import { bookingName, oneVisitOf, visitName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { AppLink, Shell } from "../components/Shell.tsx";
import { nextVisitWords, replacementLine } from "./next-visit-words.ts";
import {
  Actions,
  changingOf,
  hasBegun,
  notingOf,
  OneVisitTerms,
  VisitCard,
  whenText,
  type NotingVisit,
} from "./VisitCard.tsx";
import styles from "./home.module.css";
import { firstNameOf } from "../../../../src/lib/names.ts";

export function HomeScreen() {
  const { me, offline } = useSession();
  // A Home the phone kept from an earlier release has no invoice line, nor any payment owed.
  const invoice = me.invoice ?? null;
  const owed = me.payment_owed ?? null;
  return (
    <Shell header={{ kind: "home" }} tab="/" kept>
      <div className={styles.home}>
        <HomeBody me={me} offline={offline} />
        {owed !== null && <PaymentOwed owed={owed} />}
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
        technician={visit.technician}
      />
    );
  }
  if (visit !== null && oneVisitOf(visit) !== null) return <OneVisit visit={visit} />;
  if (visit !== null) {
    return (
      <section aria-labelledby="next">
        <h1 className={capsLook(styles.label)} id="next">
          {home.next.label}
        </h1>
        <VisitCard visit={visit} />
      </section>
    );
  }
  if (me.consultation !== null) return <ProposedConsultation consultation={me.consultation} />;
  if (me.being_booked !== null) {
    const price = oneVisitOf(me.being_booked);
    if (price === null) return <BeingBooked booking={me.being_booked} />;
    // A one visit booked on /book is booked, as the site told the client; ops move it.
    const { date, window } = me.being_booked;
    return <Consultation date={date} when={windowText(window)} place="" changing={null} noting={null} price={price} />;
  }
  if (me.state !== "fitted" && me.consulted !== null && me.booking.types.includes("first_fit")) {
    return <Consulted consulted={me.consulted} services={me.booking.services} />;
  }
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
      price={oneVisitOf(consultation)}
    />
  );
}

/** The design: the consultation card on ink, and what to expect on paper until it begins. */
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
  /** The consultation and the first fit in one visit: what it costs once fitted. */
  price?: OneVisitPrice | null;
  /** Who is coming, once a technician has the visit. */
  technician?: { readonly initials: string; readonly name: string } | null;
}) {
  const copy = home.consultation;
  const date = shortDate(props.date);
  const begun = props.begun === true;
  const price = props.price ?? null;
  const oneVisit = price !== null;
  return (
    <>
      <section aria-labelledby="consultation">
        <h1 className={capsLook(styles.label)} id="consultation">
          {oneVisit ? copy.labelOneVisit : copy.label}
        </h1>
        <div className={styles.card}>
          <p className={styles.date}>{date}</p>
          <p className={styles.window}>{props.when}</p>
          {props.technician !== undefined && props.technician !== null && (
            <div className={styles.technician}>
              <span className={styles.initials} aria-hidden="true">
                {props.technician.initials}
              </span>
              <p className={styles.who}>{firstNameOf(props.technician.name)}</p>
            </div>
          )}
          {props.place !== "" && <p className={styles.place}>{props.place}</p>}
          {!oneVisit && <p className={styles.free}>{copy.free}</p>}
          {props.requested === true && <p className={styles.free}>{copy.requested}</p>}
          {price !== null && <OneVisitTerms price={price} />}
          {!begun && (
            <Actions
              what={oneVisit ? ONE_VISIT : VISIT_TYPES.consultation}
              date={date}
              changing={props.changing}
              noting={props.noting}
            />
          )}
        </div>
      </section>
      {!begun && <WhatToExpect steps={oneVisit ? home.oneVisit.expect : home.expect.steps} />}
    </>
  );
}

/** A consultation and fit in one visit on record: its card, with what it costs once fitted, and what to expect. */
function OneVisit({ visit }: { visit: NonNullable<Me["next_visit"]> }) {
  return (
    <>
      <section aria-labelledby="next">
        <h1 className={capsLook(styles.label)} id="next">
          {home.oneVisit.label}
        </h1>
        <VisitCard visit={visit} />
      </section>
      {!hasBegun(visit) && <WhatToExpect steps={home.oneVisit.expect} />}
    </>
  );
}

function WhatToExpect({ steps }: { steps: readonly string[] }) {
  return (
    <section className={styles.expect} aria-labelledby="expect">
      <h2 className={capsLook(styles.label)} id="expect">
        {home.expect.label}
      </h2>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
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

/**
 * A visit paid for, or booked free, that is not booked yet: never said to be booked, nor its money gone. It promises
 * a WhatsApp only where one will go.
 */
function BeingBooked({ booking }: { booking: NonNullable<Me["being_booked"]> }) {
  const copy = home.beingBooked;
  return (
    <section aria-labelledby="next">
      <h1 className={capsLook(styles.label)} id="next">
        {home.next.label}
      </h1>
      <div className={styles.card}>
        <p className={styles.date}>{shortDate(booking.date)}</p>
        <p className={styles.window}>{windowText(booking.window)}</p>
        <p className={styles.place}>{bookingName(booking)}</p>
        <p className={styles.free}>{booking.paid ? copy.paid : copy.free}</p>
        {booking.told && <p className={styles.free}>{copy.told}</p>}
      </div>
    </section>
  );
}

/** A one visit the client was fitted at and has not paid for: what for, how much, and the link to pay by. */
function PaymentOwed({ owed }: { owed: NonNullable<Me["payment_owed"]> }) {
  const copy = home.owed;
  return (
    <section className={styles.prompt} aria-labelledby="owed">
      <h2 className={capsLook(styles.label)} id="owed">
        {copy.label}
      </h2>
      <p className={styles.owedLine}>{copy.line(owed.product, rupees(owed.amount))}</p>
      {owed.url === null ? (
        <p className={styles.owedWait}>{copy.onItsWay}</p>
      ) : (
        <a className={styles.promptLink} href={owed.url} target="_blank" rel="noopener">
          <span>{copy.pay}</span>
          <VisuallyHidden>{`, ${copy.newTab}`}</VisuallyHidden>
        </a>
      )}
    </section>
  );
}

/** Home's credit tile: how many free service visits, said once, and the day the soonest must be used by. */
function CreditTile({ credits }: { credits: NonNullable<Me["credits"]> }) {
  const expiry = credits.earliest_expiry;
  return (
    <div className={styles.credits}>
      <p className={styles.creditsLabel}>{home.credits.count(credits.visits)}</p>
      {expiry !== null && <p className={styles.creditsExpiry}>{expiryLine(credits, expiry)}</p>}
    </div>
  );
}

/** "Use by 2 Oct", "Use by tonight" on the day, or "1 to use by 2 Oct" where only some of them end first. */
function expiryLine(credits: NonNullable<Me["credits"]>, expiry: string): string {
  const today = indiaDate(new Date(apiNow()).toISOString());
  const lastDay = indiaDate(expiry);
  const when = lastDay === today ? home.credits.tonight : listDate(lastDay, Number(today.slice(0, 4)));
  // False for a Home the phone kept from an earlier release, which does not say how many end first.
  const someEndFirst = credits.expiring_visits < credits.visits;
  return someEndFirst ? home.credits.someUseBy(credits.expiring_visits, when) : home.credits.useBy(when);
}

type PromptOf<Kind extends NonNullable<Me["prompt"]>["kind"]> = Extract<NonNullable<Me["prompt"]>, { kind: Kind }>;

/** Home's one prompt: a line, and the way to act on it. */
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
  const words = nextVisitWords(prompt, monthInIndia(apiNow()));
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
  const thisMonth = monthInIndia(apiNow());
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
      <h1 className={capsLook(styles.label)} id="next">
        {home.next.label}
      </h1>
      <p>{home.next.none}</p>
      {!promptBooks && <BookNext className={styles.book} offerOther={false} />}
    </section>
  );
}

/**
 * The consultation done and the first fit not yet booked: its day, who came, the hair system they recommended where
 * it is offered, and the first fit to book, which the sheet opens on that hair system.
 */
function Consulted({
  consulted,
  services,
}: {
  consulted: NonNullable<Me["consulted"]>;
  services: Me["booking"]["services"];
}) {
  const copy = home.consulted;
  const technician = consulted.technician === null ? null : firstNameOf(consulted.technician.name);
  const product = services.find((service) => service.type === "first_fit" && service.tier === consulted.recommended);
  return (
    <section className={styles.nothing} aria-labelledby="consulted">
      <h1 className={capsLook(styles.label)} id="consulted">
        {copy.label}
      </h1>
      <p className={styles.consultedWhen}>{copy.when(shortDate(consulted.date), technician)}</p>
      {product !== undefined && <p>{copy.recommends(technician, product.name)}</p>}
      <BookNext className={styles.book} offerOther={false} />
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
        <ButtonLink variant="primary" size="action" className={styles.book} href={BOOKING_URL[import.meta.env.MM_ENV]}>
          {home.nothing.book}
        </ButtonLink>
      )}
    </section>
  );
}
