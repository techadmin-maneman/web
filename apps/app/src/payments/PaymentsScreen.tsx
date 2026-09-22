// Payments (board E1): one list of payments and refunds, newest first, each
// opening its own page (E2). The ex-GST figure leads, with the GST-inclusive
// amount beneath. Empty, board E3's lines. Charges arrive with booking (P2-M5).

import { rupees } from "@maneman/web-kit/money";
import { api, type Entry } from "../api.ts";
import { empty, payments } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { entryMeta, entryStatus, entryWhat } from "./entry.ts";
import styles from "./payments.module.css";

function EntryRow({ entry, thisYear }: { entry: Entry; thisYear: number }) {
  return (
    <li>
      <AppLink className={styles.entry} to={`/payments/${entry.id}`}>
        <span className={styles.entryText}>
          <span className={styles.what}>{entryWhat(entry)}</span>
          <span className={styles.meta}>{entryMeta(entry, thisYear)}</span>
          <span className={styles.status}>{entryStatus(entry)}</span>
        </span>
        <span className={styles.money}>
          <span className={entry.kind === "refund" ? `${styles.amount} ${styles.refunded}` : styles.amount}>
            {rupees(entry.amount_ex_gst)}
          </span>
          <span className={styles.incl}>{payments.incl(rupees(entry.amount))}</span>
        </span>
      </AppLink>
    </li>
  );
}

export function PaymentsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.payments);
  const thisYear = new Date().getFullYear();
  return (
    <Shell header={{ kind: "tab", title: payments.title }} tab="/payments">
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : loaded.value.entries.length === 0 ? (
        <EmptyState lines={(me.state === "fitted" ? empty.paymentsFitted : empty.payments).lines} tight />
      ) : (
        <ul className={styles.list}>
          {loaded.value.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} thisYear={thisYear} />
          ))}
        </ul>
      )}
    </Shell>
  );
}
