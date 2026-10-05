// Payments (board E1): one list of payments and refunds, newest first, each
// opening its own page (E2). The amount paid, GST included, leads, with its GST
// split beneath once GST applies; a refund is money back, with where it goes.
// Empty, board E3's lines.
//
// Among them, as the board lists a visit a credit covered, every change to the
// service-visit credits (LIFE-14): one about a visit opens that visit's page.
//
// Above them, a consultation and fit in one visit the client was fitted at and
// has not paid for, opening the link Razorpay texted.

import { capsLook } from "@maneman/ui/Caps";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useLoad } from "@maneman/ui/useLoad";
import { listDate, yearInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "../lib/clock.ts";
import { rupees } from "@maneman/web-kit/money";
import { api, type CreditLine, type Entry, type Me, type OwedPayment } from "../api.ts";
import { empty, payments } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { oneVisitOf } from "../lib/visit.ts";
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

/** A payment owed: what for, when fitted, and the link to pay by, or that it is on its way. */
function OwedRow({ owed, thisYear }: { owed: OwedPayment; thisYear: number }) {
  const copy = payments.owed;
  const body = (
    <>
      <span className={styles.entryText}>
        <span className={styles.what}>{owed.product}</span>
        <span className={styles.meta}>{copy.meta(listDate(owed.date, thisYear))}</span>
        <span className={styles.status}>{owed.url === null ? copy.onItsWay : copy.pay}</span>
      </span>
      <span className={styles.money}>
        <span className={styles.amount}>{rupees(owed.amount)}</span>
      </span>
    </>
  );
  return (
    <li>
      {owed.url === null ? (
        <div className={styles.entry}>{body}</div>
      ) : (
        <a className={styles.entry} href={owed.url} target="_blank" rel="noopener">
          {body}
          <VisuallyHidden>{`, ${copy.newTab}`}</VisuallyHidden>
        </a>
      )}
    </li>
  );
}

function Owed({ owed, thisYear }: { owed: readonly OwedPayment[]; thisYear: number }) {
  return (
    <section aria-labelledby="owed">
      <h2 className={capsLook(styles.owedLabel)} id="owed">
        {payments.owed.label}
      </h2>
      <ul className={styles.list}>
        {owed.map((each) => (
          <OwedRow key={each.visit_id} owed={each} thisYear={thisYear} />
        ))}
      </ul>
    </section>
  );
}

/** Board E3's lines for a lead, a one visit's while one is booked, or a fitted client's. */
/** A consultation and fit in one visit booked: as a visit, as asked for on /book, or on its way to FSM. */
function oneVisitBooked(me: Me): boolean {
  const booked = [me.next_visit, me.consultation, me.being_booked];
  return booked.some((each) => each !== null && oneVisitOf(each) !== null);
}

function emptyLines(me: Me): readonly [string, string] {
  if (me.state === "fitted") return empty.paymentsFitted.lines;
  if (oneVisitBooked(me)) return empty.paymentsOneVisit.lines;
  return empty.payments.lines;
}

export function PaymentsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.payments);
  const thisYear = yearInIndia(apiNow());
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
  const { owed } = loaded.value;
  return (
    <Shell header={{ kind: "tab", title: payments.title }} tab="/payments">
      {owed.length > 0 && <Owed owed={owed} thisYear={thisYear} />}
      {rows.length === 0 && owed.length === 0 && <EmptyState lines={emptyLines(me)} tight />}
      {rows.length > 0 && (
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
