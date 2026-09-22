// Visits (board C1): what is coming on ink, what has been done below, each
// past visit opening its detail (C9). A Phase 1 booking's consultation, not
// yet in FSM, shows as the one upcoming. "Book your next visit" opens WhatsApp
// to ops while self-serve booking is off, and waits for the connection
// offline. C1's "Prepaid" arrives with prepayment (P2-M5).

import { fullDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Me, type Visits } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { messages, PHASE1_WINDOWS, VISIT_TYPES, visits, WINDOW_HOURS } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { CHEVRON } from "../icons.ts";
import { useLoad } from "../lib/useLoad.ts";
import { technicianOf, visitName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import styles from "./visits.module.css";

/** An upcoming visit's card, as C1 draws it: the date, then what, when and who. */
function Upcoming({ date, parts }: { date: string; parts: readonly string[] }) {
  return (
    <li className={styles.card}>
      <p className={styles.cardDate}>{shortDate(date)}</p>
      <p className={styles.cardWhat}>{parts.join(" · ")}</p>
    </li>
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
            <Upcoming
              date={consultation.date}
              parts={[VISIT_TYPES.consultation, WINDOW_HOURS[PHASE1_WINDOWS[consultation.window_label] ?? "morning"]]}
            />
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
    </>
  );
}

function Book({ offline }: { offline: boolean }) {
  return offline ? (
    <button className={styles.book} type="button" disabled>
      {visits.book}
    </button>
  ) : (
    <a className={styles.book} href={whatsappWith(messages.book)} rel="noopener">
      {visits.book}
    </a>
  );
}

export function VisitsScreen() {
  const { me, offline } = useSession();
  const [loaded, retry] = useLoad(api.visits);
  return (
    <Shell
      header={{ kind: "tab", title: visits.title }}
      tab="/visits"
      {...(me.state === "fitted" ? { footer: <Book offline={offline} /> } : {})}
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
