// Payments and invoices, under the profile: payments and refunds by month, newest first, each opening its own page.
// The amount paid, GST included, leads, with its state beneath; a refund is money back. Empty, the documents' lines.
//
// Among them, as the board lists a visit a credit covered, every change to the service-visit credits: one about a visit
// opens that visit's page.
//
// Above them, a consultation and fit in one visit the client was fitted at and has not paid for, opening the link
// Razorpay texted.

import { Badge } from "@maneman/ui/Badge";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { TileLink } from "@maneman/ui/Tile";
import { capsLook } from "@maneman/ui/Caps";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useLoad } from "@maneman/ui/useLoad";
import { fullMonth, listDate, yearInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type OwedPayment } from "../api.ts";
import { empty, payments, profile } from "../content.ts";
import { Shell } from "../frame/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { oneVisitOf } from "../lib/visit.ts";
import { backOf } from "../route.ts";
import { useSession } from "../session.ts";
import { Loading } from "@maneman/ui/States";
import { PageFailed } from "../frame/PageFailed.tsx";
import {
  creditAmount,
  creditMeta,
  creditStatus,
  creditWhat,
  entryAmount,
  entryMeta,
  entryStatus,
  entryTitle,
  entryTone,
  paymentsAndCredits,
  type PaymentsRow,
} from "./entry.ts";
import styles from "./payments-screen.module.css";

/** A row's figure and its state beneath it. */
function Figure({
  amount,
  status,
  tone,
}: {
  amount: string | null;
  status: string;
  tone: Parameters<typeof Badge>[0]["tone"];
}) {
  return (
    <span className={styles.figure}>
      {amount !== null && <span className={styles.amount}>{amount}</span>}
      <Badge tone={tone}>{status}</Badge>
    </span>
  );
}

function Row({ row, thisYear }: { row: PaymentsRow; thisYear: number }) {
  if (row.kind === "entry") {
    const { entry } = row;
    return (
      <ListRow
        title={entryTitle(entry)}
        meta={entryMeta(entry, thisYear)}
        end={<Figure amount={entryAmount(entry)} status={entryStatus(entry)} tone={entryTone(entry)} />}
        endTone="plain"
        to={`/profile/payments/${entry.id}`}
        chevron
      />
    );
  }
  // A change to the credits, drawn as Payments draws a visit a credit covered.
  const { line } = row;
  const { amount, count } = creditAmount(line);
  return (
    <ListRow
      title={creditWhat(line)}
      meta={`${creditMeta(line, thisYear)} · ${count}`}
      end={<Figure amount={amount} status={creditStatus(line)} tone="neutral" />}
      endTone="plain"
      to={line.visit === null ? undefined : `/visits/${line.visit.id}`}
      chevron={line.visit !== null}
    />
  );
}

/** The rows by month, newest first: each month under its name. */
function byMonth(rows: readonly PaymentsRow[]): [string, PaymentsRow[]][] {
  const months = new Map<string, PaymentsRow[]>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), row]);
  }
  return [...months];
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
        <TileLink className={styles.entry} href={owed.url} newTab>
          {body}
          <VisuallyHidden>{`, ${copy.newTab}`}</VisuallyHidden>
        </TileLink>
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

/** A consultation and fit in one visit booked: as a visit, as asked for on /book, or on its way to FSM. */
function oneVisitBooked(me: Me): boolean {
  const booked = [me.next_visit, me.consultation, me.being_booked];
  return booked.some((each) => each !== null && oneVisitOf(each) !== null);
}

/** The documents' lines for a lead, a one visit's while one is booked, or a fitted client's. */
function emptyLines(me: Me): readonly [string, string] {
  if (me.state === "fitted") return empty.paymentsFitted.lines;
  if (oneVisitBooked(me)) return empty.paymentsOneVisit.lines;
  return empty.payments.lines;
}

const HEADER = { kind: "back", title: payments.title, to: backOf({ page: "payments" }), label: profile.back } as const;

export function PaymentsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.payments);
  const thisYear = yearInIndia(apiNow());
  if (loaded.state === "loading") {
    return (
      <Shell header={HEADER} tab={null}>
        <Loading />
      </Shell>
    );
  }
  if (loaded.state === "failed") {
    return (
      <Shell header={HEADER} tab={null}>
        <PageFailed onRetry={retry} />
      </Shell>
    );
  }
  const rows = paymentsAndCredits(loaded.value.entries, loaded.value.credits);
  const { owed } = loaded.value;
  return (
    <Shell header={HEADER} tab={null}>
      {owed.length > 0 && <Owed owed={owed} thisYear={thisYear} />}
      {rows.length === 0 && owed.length === 0 && <EmptyState look="page" lines={emptyLines(me)} tight />}
      {rows.length > 0 && (
        <div className={styles.page}>
          {byMonth(rows).map(([month, each]) => (
            <section key={month} aria-labelledby={`month-${month}`}>
              <h2 className={styles.month} id={`month-${month}`}>
                {fullMonth(month)}
              </h2>
              <ListRows className={styles.rows}>
                {each.map((row) => (
                  <Row key={row.kind === "entry" ? row.entry.id : row.line.id} row={row} thisYear={thisYear} />
                ))}
              </ListRows>
            </section>
          ))}
          <p className={styles.note}>{payments.note}</p>
        </div>
      )}
    </Shell>
  );
}
