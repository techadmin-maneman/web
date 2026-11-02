// The client's History tab: what their visits add up to, from the record the page already holds, and, for whoever may
// read the audit log, everything done on the record and by them, the latest first. What they paid, how many visits
// and when their piece falls due are at the page's right (./ClientAside.tsx).

import { shortMonth } from "@maneman/web-kit/dates";
import { Panel } from "@maneman/ui/Panel";
import { PanelLoading } from "@maneman/ui/States";
import { Suspense } from "react";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { plainDate } from "@maneman/web-kit/plain-date";
import type { ClientRecord } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./history.module.css";

const copy = clients.history;

const RecordActivity = lazyScreen(() => import("../activity/index.ts").then((module) => module.RecordActivity));

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.historyRow}>
      <dt className={styles.historyKey}>{label}</dt>
      <dd className={styles.historyValue}>{value}</dd>
    </div>
  );
}

export function History({ clientId, history }: { clientId: string; history: ClientRecord["history"] }) {
  const mayReadLog = useAccess().mayCall("GET /api/activity");
  return (
    <Panel titleId="client-history" title={copy.title}>
      <dl className={styles.historyList}>
        <HistoryRow
          label={copy.rows.firstFit}
          value={history.first_fit_on === null ? copy.noFirstFit : plainDate(history.first_fit_on)}
        />
        <HistoryRow label={copy.rows.services} value={String(history.services)} />
        <HistoryRow label={copy.rows.replacements} value={String(history.replacements)} />
        <HistoryRow
          label={copy.rows.lastVisit}
          value={history.last_visit_on === null ? copy.noVisit : plainDate(history.last_visit_on)}
        />
      </dl>
      {mayReadLog && (
        <Suspense fallback={<PanelLoading />}>
          <RecordActivity person={clientId} />
        </Suspense>
      )}
    </Panel>
  );
}

/** The head's replacement line, as the board writes it: the month, never the day (ADR 0059). A client fitted with no
 * hair system recorded says so, rather than that none was fitted. */
export const replacementDueOf = (history: ClientRecord["history"], fitted = false): string => {
  if (history.replacement_due !== null) return shortMonth(history.replacement_due.month);
  return fitted ? clients.pieceNotRecorded : clients.noPiece;
};
