// What the client's record adds up to: visits, purchases, payments, and when their piece falls due, from the record the
// page already holds, so the tab asks for nothing. For whoever may read the audit log, it links to everything done on
// the record, in Activity.

import { fullDate, shortMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { ClientRecord } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { activityPath } from "../route.ts";
import styles from "./history.module.css";

const copy = clients.history;

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.historyRow}>
      <dt className={styles.historyKey}>{label}</dt>
      <dd className={styles.historyValue}>{value}</dd>
    </div>
  );
}

export function History({ clientId, history }: { clientId: string; history: ClientRecord["history"] }) {
  const due = history.replacement_due;
  const mayReadLog = useAccess().mayCall("GET /api/activity");
  return (
    <section className={styles.history} aria-label={copy.title}>
      <dl className={styles.historyList}>
        <HistoryRow
          label={copy.rows.firstFit}
          value={history.first_fit_on === null ? copy.noFirstFit : fullDate(history.first_fit_on)}
        />
        <HistoryRow label={copy.rows.visits} value={String(history.visits)} />
        <HistoryRow label={copy.rows.services} value={String(history.services)} />
        <HistoryRow label={copy.rows.replacements} value={String(history.replacements)} />
        <HistoryRow
          label={copy.rows.lastVisit}
          value={history.last_visit_on === null ? copy.noVisit : fullDate(history.last_visit_on)}
        />
        <HistoryRow
          label={copy.rows.replacement}
          value={due === null ? copy.noPiece : copy.due(fullDate(due.on), due.piece_code)}
        />
        <HistoryRow label={copy.rows.spend} value={rupees(history.spend)} />
      </dl>
      {mayReadLog && (
        <p className={styles.historyActivity}>
          <OpsLink to={activityPath({ person: clientId })}>{copy.activity}</OpsLink>
        </p>
      )}
    </section>
  );
}

/** The head's fifth line, as the board writes it: the month, never the day (ADR 0059). */
export const replacementDueOf = (history: ClientRecord["history"]): string =>
  history.replacement_due === null ? clients.noPiece : shortMonth(history.replacement_due.month);
