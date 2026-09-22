// The tabs beyond Home, as a lead sees them: Visits lists the consultation,
// and Photos, Payments and Refer show the design's empty states (boards C1,
// D3, E3 and F6). Their full screens arrive with P2-F2 and P2-F3.

import { shortDate } from "@maneman/web-kit/dates";
import type { Me } from "../api.ts";
import { empty, visits, WINDOWS } from "../content.ts";
import styles from "./tabs.module.css";

export function VisitsScreen({ me }: { me: Me }) {
  const { consultation } = me;
  return (
    <section aria-labelledby="visits">
      <h1 className={styles.title} id="visits">
        {visits.title}
      </h1>
      <h2 className={styles.label}>{visits.upcoming}</h2>
      {consultation === null ? (
        <p className={styles.line}>{visits.none}</p>
      ) : (
        <div className={styles.row}>
          <p className={styles.rowDate}>{shortDate(consultation.date)}</p>
          <p className={styles.rowWhat}>
            {visits.consultation} · {WINDOWS[consultation.window_label]}
          </p>
        </div>
      )}
    </section>
  );
}

export function EmptyScreen({ which }: { which: keyof typeof empty }) {
  const copy = empty[which];
  const [first, second] = copy.lines;
  return (
    <section aria-labelledby={which}>
      <h1 className={styles.title} id={which}>
        {copy.title}
      </h1>
      <div className={styles.empty}>
        <p className={styles.emptyFirst}>{first}</p>
        <p className={styles.line}>{second}</p>
      </div>
    </section>
  );
}
