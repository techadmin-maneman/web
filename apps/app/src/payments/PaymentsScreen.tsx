// Payments (board E1): one list of payments and refunds, newest first, each
// opening its own page (E2). The amount paid, GST included, leads, with its GST
// split beneath once GST applies; a refund is money back, with where it goes.
// Empty, board E3's lines.
//
// Among them, as the board lists a visit a credit covered, every change to the
// service-visit credits (LIFE-14): one about a visit opens that visit's page.

import { useLoad } from "@maneman/ui/useLoad";
import { api, type CreditLine, type Entry } from "../api.ts";
import { empty, payments } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { useSession } from "../session.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import {
  creditAmount,
  creditMeta,
  creditStatus,
  creditWhat,
  entryAmount,
  entryBeneath,
  entryMeta,
  entryStatus,
  entryTitle,
  paymentsAndCredits,
} from "./entry.ts";
import styles from "./payments.module.css";

function EntryRow({ entry, thisYear }: { entry: Entry; thisYear: number }) {
  const beneath = entryBeneath(entry);
  return (
    <li>
      <AppLink className={styles.entry} to={`/payments/${entry.id}`}>
        <span className={styles.entryText}>
          <span className={styles.what}>{entryTitle(entry)}</span>
          <span className={styles.meta}>{entryMeta(entry, thisYear)}</span>
          <span className={styles.status}>{entryStatus(entry)}</span>
        </span>
        <span className={styles.money}>
          <span className={entry.kind === "refund" ? `${styles.amount} ${styles.refunded}` : styles.amount}>
            {entryAmount(entry)}
          </span>
          {beneath !== null && <span className={styles.incl}>{beneath}</span>}
        </span>
      </AppLink>
    </li>
  );
}

/** A change to the credits, drawn as board E1 draws a visit a credit covered. */
function CreditRow({ line, thisYear }: { line: CreditLine; thisYear: number }) {
  const { amount, count } = creditAmount(line);
  const body = (
    <>
      <span className={styles.entryText}>
        <span className={styles.what}>{creditWhat(line)}</span>
        <span className={styles.meta}>{creditMeta(line, thisYear)}</span>
        <span className={styles.status}>{creditStatus(line)}</span>
      </span>
      <span className={styles.money}>
        {amount !== null && <span className={styles.amount}>{amount}</span>}
        <span className={styles.incl}>{count}</span>
      </span>
    </>
  );
  return (
    <li>
      {line.visit === null ? (
        <div className={styles.entry}>{body}</div>
      ) : (
        <AppLink className={styles.entry} to={`/visits/${line.visit.id}`}>
          {body}
        </AppLink>
      )}
    </li>
  );
}

export function PaymentsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.payments);
  const thisYear = new Date().getFullYear();
  if (loaded.state === "loading") {
    return (
      <Shell header={{ kind: "tab", title: payments.title }} tab="/payments">
        <Loading />
      </Shell>
    );
  }
  if (loaded.state === "failed") {
    return (
      <Shell header={{ kind: "tab", title: payments.title }} tab="/payments">
        <PageFailed onRetry={retry} />
      </Shell>
    );
  }
  const rows = paymentsAndCredits(loaded.value.entries, loaded.value.credits);
  return (
    <Shell header={{ kind: "tab", title: payments.title }} tab="/payments">
      {rows.length === 0 ? (
        <EmptyState lines={(me.state === "fitted" ? empty.paymentsFitted : empty.payments).lines} tight />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) =>
            row.kind === "entry" ? (
              <EntryRow key={row.entry.id} entry={row.entry} thisYear={thisYear} />
            ) : (
              <CreditRow key={row.line.id} line={row.line} thisYear={thisYear} />
            ),
          )}
        </ul>
      )}
    </Shell>
  );
}
