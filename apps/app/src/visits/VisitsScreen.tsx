// Visits (board C1): what is coming on ink, what has been done or cancelled
// below, each opening its own page (C9 for one done). A booking's
// consultation, not yet a visit, shows as the one upcoming, and a visit being
// booked shows in its day's place, in Home's words. A visit not yet closed
// stays under upcoming, saying where it stands, and "Book your next
// visit" waits while it is. That opens WhatsApp to ops while self-serve
// booking is off, and waits for the connection offline. "Prepaid" marks a
// visit paid for ahead, or covered by a credit.
//
// Beneath them, the client's own record, which the board draws nowhere: how
// often they have been served, what they have bought, what they have paid, and
// the month their piece falls due (docs/fidelity-method.md).

import { BookNext } from "../booking/index.ts";
import { hasBegun, stageText } from "../home/index.ts";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Icon } from "@maneman/ui/Icon";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { fullDate, listMonth, monthInIndia, shortDate, yearInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "../lib/clock.ts";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type VisitSummary, type Visits } from "../api.ts";
import { home, ONE_VISIT, VISIT_TYPES, visits, WINDOW_HOURS } from "../content.ts";
import { AppLink, Shell } from "../components/Shell.tsx";
import { CHEVRON } from "../icons.ts";
import { bookingName, oneVisitOf, technicianOf, visitTitle } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { upcomingEntries, type UpcomingEntry } from "./upcoming.ts";
import styles from "./visits.module.css";

const copy = visits.record;

/** An upcoming visit's card, as C1 draws it: the date and whether it is paid, then what, when and who. */
function UpcomingCard({ date, parts, prepaid }: { date: string; parts: readonly string[]; prepaid: boolean }) {
  return (
    <>
      <span className={styles.cardHead}>
        <span className={styles.cardDate}>{shortDate(date)}</span>
        {prepaid && <span className={capsLook(styles.prepaid)}>{visits.prepaid}</span>}
      </span>
      <span className={styles.cardWhat}>{parts.join(" · ")}</span>
    </>
  );
}

/** A visit, which opens its own page; the window, or where one that has begun stands. */
function Upcoming({ visit }: { visit: VisitSummary }) {
  const when = stageText(visit) ?? WINDOW_HOURS[visit.window_label];
  // A one visit still to happen goes by that name; any other by its kind, and its service where that says more.
  const what = oneVisitOf(visit) === null ? visitTitle(visit) : ONE_VISIT;
  const parts = [what, when, ...technicianOf(visit)];
  return (
    <li>
      <AppLink className={styles.card} to={`/visits/${visit.id}`}>
        <UpcomingCard date={visit.date} parts={parts} prepaid={visit.prepaid} />
      </AppLink>
    </li>
  );
}

/**
 * A visit paid for, or booked free, that is not booked yet: no page to open, and never said to be booked. A one visit
 * from /book is, as Home says.
 */
function BeingBooked({ booking }: { booking: NonNullable<Me["being_booked"]> }) {
  const words = home.beingBooked;
  return (
    <li className={styles.card}>
      <UpcomingCard date={booking.date} parts={[bookingName(booking), WINDOW_HOURS[booking.window]]} prepaid={false} />
      {oneVisitOf(booking) === null && (
        <span className={styles.cardNote}>{booking.paid ? words.paid : words.free}</span>
      )}
    </li>
  );
}

/** A consultation from the site: what it is, its window, and whether it is only asked for. */
function proposedParts(consultation: NonNullable<Me["consultation"]>): string[] {
  const what = oneVisitOf(consultation) === null ? VISIT_TYPES.consultation : ONE_VISIT;
  const parts = [what, WINDOW_HOURS[consultation.window]];
  if (consultation.requested) parts.push(visits.requested);
  return parts;
}

function UpcomingItem({ entry }: { entry: UpcomingEntry }) {
  switch (entry.kind) {
    case "visit":
      return <Upcoming visit={entry.visit} />;
    case "being_booked":
      return <BeingBooked booking={entry.booking} />;
    case "consultation": {
      // A consultation from the site has no page of its own to open.
      const { consultation } = entry;
      return (
        <li className={styles.card}>
          <UpcomingCard date={consultation.date} parts={proposedParts(consultation)} prepaid={false} />
        </li>
      );
    }
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
      <h2 className={classes(styles.label, styles.recordLabel)} id="record">
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
        <Fact label={copy.rows.spend} value={rupees(history.spend)} note={copy.gst} />
      </dl>
    </section>
  );
}

/** A past visit's line: what it was and who did it, or that it was cancelled. */
function pastLine(visit: VisitSummary): string {
  const after = visit.status === "cancelled" ? [visits.cancelled] : technicianOf(visit);
  return [visitTitle(visit), ...after].join(" · ");
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
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

function VisitList({ list, me }: { list: Visits; me: Me }) {
  const { past } = list;
  const upcoming = upcomingEntries(list.upcoming, me.consultation, me.being_booked);
  return (
    <>
      <h2 className={capsLook(styles.label)}>{visits.upcoming}</h2>
      {upcoming.length === 0 ? (
        <p className={styles.none}>{visits.none}</p>
      ) : (
        <ul className={styles.upcoming}>
          {upcoming.map((entry) => (
            <UpcomingItem key={keyOf(entry)} entry={entry} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <>
          <h2 className={classes(styles.label, styles.pastLabel)}>{visits.past}</h2>
          <ul className={styles.past}>
            {past.map((visit) => (
              <li key={visit.id}>
                <AppLink className={styles.row} to={`/visits/${visit.id}`}>
                  <span>
                    <span className={styles.rowDate}>{fullDate(visit.date)}</span>
                    <span className={styles.rowWhat}>{pastLine(visit)}</span>
                  </span>
                  <Icon className={styles.chevron} d={CHEVRON} size={17} />
                </AppLink>
              </li>
            ))}
          </ul>
        </>
      )}
      <Record history={list.history} />
    </>
  );
}

export function VisitsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.visits);
  const firstFit = me.booking.types.includes("first_fit");
  // While a visit is under way or being closed, another is not booked in its place.
  const begun = me.next_visit !== null && hasBegun(me.next_visit);
  // The visit the app offers, with its day and window chosen, and the other kind beside it for a fitted client (ADR 0086).
  const book = <BookNext className={styles.book} otherClassName={styles.other} />;
  return (
    <Shell
      header={{ kind: "tab", title: visits.title }}
      tab="/visits"
      {...((me.state === "fitted" || firstFit) && !begun ? { footer: book } : {})}
    >
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} offlineLine={visits.offline} />,
        loaded: (list) => <VisitList list={list} me={me} />,
      })}
    </Shell>
  );
}
