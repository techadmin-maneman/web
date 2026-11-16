// Visits (design/client-redesign, Visits): Upcoming, Past and Issues, side by side, each a list of rows opening its own
// page. An upcoming visit is its date in a navy square, what it is, and its day, time and technician, marked paid or free.
// A booking's consultation, not yet a visit, shows as the one upcoming, and a visit being booked shows in its day's place,
// in Home's words. A visit not yet closed stays under upcoming, saying where it stands. With nothing upcoming, the visit
// the app offers is booked from the foot; that opens WhatsApp to ops while self-serve booking is off, and waits for the
// connection offline.
//
// Beneath them, the client's own record, which the board draws nowhere: how
// often they have been served, what they have bought, what they have paid, and
// the month their piece falls due (docs/fidelity-method.md).

import { ICONS } from "@maneman/brand/icons";
import { buttonLook } from "@maneman/ui/Button";
import { Badge } from "@maneman/ui/Badge";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Segmented } from "@maneman/ui/Segmented";
import { useState, type ReactNode } from "react";
import { BookNext } from "../booking/index.ts";
import { stageText } from "../home/index.ts";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Icon } from "@maneman/ui/Icon";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { dayMonth, fullDate, listMonth, monthInIndia, weekdayName, yearInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type VisitSummary, type Visits } from "../api.ts";
import { arrivalHours, home, issues, ONE_VISIT, VISIT_TYPES, visits, windowHours } from "../content.ts";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { bookingName, oneVisitOf, technicianOf, visitTitle } from "../lib/visit.ts";
import { openIssues } from "../lib/counts.ts";
import { useSession } from "../session.ts";
import { IssueList } from "./IssueList.tsx";
import { Loading } from "@maneman/ui/States";
import { PageFailed } from "../frame/PageFailed.tsx";
import { upcomingEntries, type UpcomingEntry } from "./upcoming.ts";
import styles from "./visits.module.css";

const copy = visits.record;

/** A visit's date in a navy square: its month over its day. */
function DateSquare({ date }: { date: string }) {
  const [day, month] = dayMonth(date).split(" ");
  return (
    <span className={styles.square}>
      <span className={styles.squareMonth}>{month}</span>
      <span className={styles.squareDay}>{day}</span>
    </span>
  );
}

/** An upcoming row: its date, what it is, then its day, time and who; marked paid, free or asked for. */
function UpcomingRow({
  date,
  what,
  parts,
  tag,
  to,
}: {
  date: string;
  what: string;
  parts: readonly string[];
  tag: ReactNode;
  to?: string | undefined;
}) {
  return (
    <ListRow
      mark={<DateSquare date={date} />}
      title={what}
      meta={[weekdayName(date), ...parts].join(" · ")}
      end={tag}
      endTone="plain"
      to={to}
      chevron={to !== undefined}
    />
  );
}

/** A visit, which opens its own page; the window, or where one that has begun stands. */
function Upcoming({ visit }: { visit: VisitSummary }) {
  const when = stageText(visit) ?? arrivalHours(visit);
  // A one visit still to happen goes by that name; any other by its kind, and its service where that says more.
  const what = oneVisitOf(visit) === null ? visitTitle(visit) : ONE_VISIT;
  const due = visit.pay_at_visit;
  let tag: ReactNode;
  if (visit.prepaid) tag = <Badge tone="done">{visits.paid}</Badge>;
  else if (visit.type === "consultation") tag = <Badge>{visits.free}</Badge>;
  const parts = [when, ...technicianOf(visit), ...(due === null ? [] : [visits.payAtVisit(rupees(due))])];
  return <UpcomingRow date={visit.date} what={what} parts={parts} tag={tag} to={`/visits/${visit.id}`} />;
}

/**
 * A visit paid for, or booked free, that is not booked yet: no page to open, and never said to be booked. A one visit
 * from /book is, as Home says.
 */
function BeingBooked({ booking }: { booking: NonNullable<Me["being_booked"]> }) {
  const words = home.beingBooked;
  const note = oneVisitOf(booking) === null ? [booking.paid ? words.paid : words.free] : [];
  return (
    <UpcomingRow
      date={booking.date}
      what={bookingName(booking)}
      parts={[windowHours(booking.hours), ...note]}
      tag={booking.paid ? <Badge tone="done">{visits.paid}</Badge> : undefined}
    />
  );
}

/** A consultation from the site: what it is, its window, and whether it is only asked for. */
function Consultation({ consultation }: { consultation: NonNullable<Me["consultation"]> }) {
  const what = oneVisitOf(consultation) === null ? VISIT_TYPES.consultation : ONE_VISIT;
  const tag = consultation.requested ? (
    <Badge tone="attention">{visits.requested}</Badge>
  ) : (
    <Badge>{visits.free}</Badge>
  );
  return <UpcomingRow date={consultation.date} what={what} parts={[windowHours(consultation.hours)]} tag={tag} />;
}

function UpcomingItem({ entry }: { entry: UpcomingEntry }) {
  switch (entry.kind) {
    case "visit":
      return <Upcoming visit={entry.visit} />;
    case "being_booked":
      return <BeingBooked booking={entry.booking} />;
    case "consultation":
      // A consultation from the site has no page of its own to open.
      return <Consultation consultation={entry.consultation} />;
  }
}

/**
 * The client's own record, beneath their visits. It sits at the foot so board
 * C1's own two lists stand where it draws them, and nothing is drawn at all
 * until there is something true to say: a client with no visit and no piece has
 * no record, and sees C1 exactly as it is drawn.
 *
 * The replacement is given as a month, never a day (ADR 0059).
 */
function Record({ history }: { history: Visits["history"] }) {
  const due = history.replacement_due;
  if (history.visits === 0 && due === null) return null;
  const now = apiNow();
  const thisMonth = monthInIndia(now);
  const month = due === null ? "" : listMonth(due.month, yearInIndia(now));
  return (
    <section className={styles.record} aria-labelledby="record">
      <h2 className={capsLook(classes(styles.label, styles.recordLabel))} id="record">
        {copy.label}
      </h2>
      {due !== null && (
        <div className={styles.due}>
          <p className={styles.dueLine}>{due.month < thisMonth ? copy.overdue(month) : copy.due(month)}</p>
        </div>
      )}
      <dl className={styles.facts}>
        <Fact
          label={copy.rows.firstFit}
          value={history.first_fit_on === null ? copy.noFirstFit : fullDate(history.first_fit_on)}
        />
        <Fact label={copy.rows.services} value={String(history.services)} />
        <Fact label={copy.rows.replacements} value={String(history.replacements)} />
        <Fact
          label={copy.rows.spend}
          value={rupees(history.spend)}
          note={history.spend_has_gst ? copy.gst : undefined}
        />
      </dl>
    </section>
  );
}

/** A visit's line in the history: what it was and who did it, or that it was cancelled, missed or partly done. */
function pastLine(visit: VisitSummary): string {
  const after = (): string[] => {
    if (visit.status === "cancelled") return [visits.cancelled];
    if (visit.status === "terminated") return [visit.not_home ? visits.notHome : visits.partial];
    if (visit.stage === "missed") return [visits.missedByUs];
    return technicianOf(visit);
  };
  return [visitTitle(visit), ...after()].join(" · ");
}

function Fact({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={styles.numeric}>
        {value}
        {note !== undefined && <span className={styles.factNote}>{note}</span>}
      </dd>
    </div>
  );
}

/** Each entry's key: a visit's ID, or the one consultation or booking of its kind. */
const keyOf = (entry: UpcomingEntry): string => (entry.kind === "visit" ? entry.visit.id : entry.kind);

function UpcomingList({ list, me }: { list: Visits; me: Me }) {
  const upcoming = upcomingEntries(list.upcoming, me.consultation, me.being_booked);
  if (upcoming.length === 0) return <p className={styles.none}>{visits.none}</p>;
  return (
    <ListRows className={styles.upcoming}>
      {upcoming.map((entry) => (
        <UpcomingItem key={keyOf(entry)} entry={entry} />
      ))}
    </ListRows>
  );
}

/** A visit the client was not home for, which the history says in red. */
const missed = (visit: VisitSummary) => visit.status === "terminated" && visit.not_home;

function PastList({ list }: { list: Visits }) {
  return (
    <>
      {list.past.length === 0 ? (
        <p className={styles.none}>{visits.noneYet}</p>
      ) : (
        <ListRows className={styles.past}>
          {list.past.map((visit) => (
            <ListRow
              key={visit.id}
              title={fullDate(visit.date)}
              meta={missed(visit) ? <span className={styles.missed}>{visits.notHome}</span> : pastLine(visit)}
              to={`/visits/${visit.id}`}
              chevron
            />
          ))}
        </ListRows>
      )}
      <Record history={list.history} />
    </>
  );
}

type Show = "upcoming" | "past" | "issues";

/** The action at the foot: on Issues, reporting one; else the visit the app offers, while one may be booked. */
function footerOf(shown: Show, me: Me) {
  if (shown === "issues") {
    return me.state === "fitted" ? (
      <AppLink
        className={buttonLook({ variant: "primary", size: "action", className: styles.book })}
        to="/visits/issues/new"
      >
        <Icon d={ICONS.plus} size="md" />
        {issues.report}
      </AppLink>
    ) : undefined;
  }
  const firstFit = me.booking.types.includes("first_fit");
  // With a visit booked, under way or being closed, none is offered beside it.
  const upcoming = me.next_visit !== null || me.consultation !== null || me.being_booked !== null;
  if ((me.state !== "fitted" && !firstFit) || upcoming) return undefined;
  // The visit the app offers, with its day and window chosen, and the other kind beside it for a fitted client (ADR 0086).
  return <BookNext className={styles.book} otherClassName={styles.other} />;
}

export function VisitsScreen({ show = "upcoming" }: { show?: Show }) {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.visits);
  const [shown, setShown] = useState<Show>(show);
  const open = openIssues(me);
  const footer = footerOf(shown, me);
  return (
    <Shell header={{ kind: "tab", title: visits.title }} tab="/visits" {...(footer === undefined ? {} : { footer })}>
      <Segmented
        className={styles.segments}
        label={visits.show}
        options={[
          ["upcoming", visits.upcoming],
          ["past", visits.past],
          ["issues", visits.issues, open],
        ]}
        value={shown}
        onChange={setShown}
      />
      {shown === "issues" ? (
        <IssueList />
      ) : (
        whenLoaded(loaded, {
          loading: <Loading />,
          failed: <PageFailed onRetry={retry} offlineLine={visits.offline} />,
          loaded: (list) => (shown === "upcoming" ? <UpcomingList list={list} me={me} /> : <PastList list={list} />),
        })
      )}
    </Shell>
  );
}
