// What the client's record adds up to: how often they have been served, what
// they have bought, what they have paid, and when their piece falls due. The
// design draws no such tab; the figures are the ones its own drawer and page
// head imply (docs/fidelity-method.md).
//
// The record is already loaded for the page's head, so this tab fetches
// nothing: moving on to it costs no request at all.

import { fullDate, shortMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { ClientRecord } from "../api.ts";
import { clients } from "../content.ts";
import styles from "./clients.module.css";

const copy = clients.history;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.historyRow}>
      <dt className={styles.historyKey}>{label}</dt>
      <dd className={styles.historyValue}>{value}</dd>
    </div>
  );
}

export function History({ history }: { history: ClientRecord["history"] }) {
  const due = history.replacement_due;
  return (
    <section className={styles.history} aria-label={copy.title}>
      <dl className={styles.historyList}>
        <Row
          label={copy.rows.firstFit}
          value={history.first_fit_on === null ? copy.noFirstFit : fullDate(history.first_fit_on)}
        />
        <Row label={copy.rows.visits} value={String(history.visits)} />
        <Row label={copy.rows.services} value={String(history.services)} />
        <Row label={copy.rows.replacements} value={String(history.replacements)} />
        <Row
          label={copy.rows.lastVisit}
          value={history.last_visit_on === null ? copy.noVisit : fullDate(history.last_visit_on)}
        />
        <Row
          label={copy.rows.replacement}
          value={due === null ? copy.noPiece : copy.due(fullDate(due.on), due.piece_code)}
        />
        <Row label={copy.rows.spend} value={rupees(history.spend)} />
      </dl>
      <p className={styles.note}>{copy.note}</p>
    </section>
  );
}

/** The head's fifth line, as the board writes it: the month, never the day (ADR 0059). */
export const replacementDueOf = (history: ClientRecord["history"]): string =>
  history.replacement_due === null ? clients.noPiece : shortMonth(history.replacement_due.month);
