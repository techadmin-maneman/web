// Visits (board C1): what is coming on ink, what has been done below, each
// past visit opening its detail (C9). A booking's consultation, not
// yet in FSM, shows as the one upcoming. "Book your next visit" opens WhatsApp
// to ops while self-serve booking is off, and waits for the connection
// offline. C1's "Prepaid" arrives with prepayment (P2-M5).
//
// Beneath them, the client's own record, which the board draws nowhere: how
// often they have been served, what they have bought, what they have paid, and
// the month their piece falls due (docs/fidelity-method.md).

import { fullDate, listMonth, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type Visits } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { BookButton } from "../booking/BookButton.tsx";
import { home, messages, VISIT_TYPES, visits, WINDOW_HOURS } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { CHEVRON } from "../icons.ts";
import { useLoad } from "../lib/useLoad.ts";
import { technicianOf, visitName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import styles from "./visits.module.css";

const copy = visits.record;

/** An upcoming visit's card, as C1 draws it: the date, then what, when and who. */
function Upcoming({ date, parts }: { date: string; parts: readonly string[] }) {
  return (
    <li className={styles.card}>
      <p className={styles.cardDate}>{shortDate(date)}</p>
      <p className={styles.cardWhat}>{parts.join(" · ")}</p>
    </li>
  );
}

/**
 * The client's own record, beneath their visits. It sits at the foot so board
 * C1's own two lists stand where it draws them, and nothing is drawn at all
 * until there is something true to say: a client with no visit and no piece has
 * no record, and sees C1 exactly as it is drawn.
 *
 * The replacement is given as a month, never a day. The date is worked out
 * afresh from FSM's install date on every sync, so a day shown here could move
 * under the client who read it (ADR 0059).
 */
function Record({ history }: { history: Visits["history"] }) {
  const due = history.replacement_due;
  if (history.visits === 0 && due === null) return null;
  const now = new Date();
  const thisMonth = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = due === null ? "" : listMonth(due.month, now.getFullYear());
  return (
    <section className={styles.record} aria-labelledby="record">
      <h2 className={`${styles.label ?? ""} ${styles.recordLabel ?? ""}`} id="record">
        {copy.label}
      </h2>
      {due !== null && (
        <div className={styles.due}>
          <p className={styles.dueLine}>{due.month < thisMonth ? copy.overdue(month) : copy.due(month)}</p>
          <p className={styles.dueNote}>{copy.approximate}</p>
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

function VisitList({ list, consultation }: { list: Visits; consultation: Me["consultation"] }) {
  const { upcoming, past } = list;
  return (
    <>
      <h2 className={styles.label}>{visits.upcoming}</h2>
      {upcoming.length === 0 && consultation === null ? (
        <p className={styles.none}>{visits.none}</p>
      ) : (
        <ul className={styles.upcoming}>
          {upcoming.length === 0 && consultation !== null && (
            <Upcoming date={consultation.date} parts={[VISIT_TYPES.consultation, WINDOW_HOURS[consultation.window]]} />
          )}
          {upcoming.map((visit) => (
            <Upcoming
              key={visit.id}
              date={visit.date}
              parts={[visitName(visit.type), WINDOW_HOURS[visit.window_label], ...technicianOf(visit)]}
            />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <>
          <h2 className={`${styles.label} ${styles.pastLabel}`}>{visits.past}</h2>
          <ul className={styles.past}>
            {past.map((visit) => (
              <li key={visit.id}>
                <AppLink className={styles.row} to={`/visits/${visit.id}`}>
                  <span>
                    <span className={styles.rowDate}>{fullDate(visit.date)}</span>
                    <span className={styles.rowWhat}>
                      {[visitName(visit.type), ...technicianOf(visit)].join(" · ")}
                    </span>
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
  const book = (
    <BookButton
      className={styles.book}
      label={firstFit ? home.next.bookFirstFit : visits.book}
      message={firstFit ? messages.bookFirstFit : messages.book}
    />
  );
  return (
    <Shell
      header={{ kind: "tab", title: visits.title }}
      tab="/visits"
      {...(me.state === "fitted" || firstFit ? { footer: book } : {})}
    >
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <VisitList list={loaded.value} consultation={me.consultation} />
      )}
    </Shell>
  );
}
