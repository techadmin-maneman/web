// The client's Visits tab: every visit in one table, past its day first, then to come, then done, from the record the
// page holds; where nothing is to come, what falls due next and a way to book it (./BookOne.tsx). From here ops set a
// visit's discount code (VisitCode.tsx) and cancel one (CancelVisit.tsx) or close one by hand (CloseVisit.tsx).
// Beneath, any booking that refunded itself, and why.

import { typeLook } from "@maneman/ui/type";
import { Panel } from "@maneman/ui/Panel";
import { NoValue } from "@maneman/ui/NoValue";
import { Badge } from "@maneman/ui/Badge";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Button, RowButton } from "@maneman/ui/Button";
import { rowRule, Table } from "@maneman/ui/Table";
import { EmptyState } from "@maneman/ui/EmptyState";
import { indiaClock, longDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useRef, useState } from "react";
import type { AutoRefund, ClientRecord, ClientVisit } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { dispatchPath } from "../route.ts";
import styles from "./clients.module.css";
import type { Booking } from "./BookOne.tsx";
import { CancelVisit } from "./CancelVisit.tsx";
import { CloseVisit } from "./CloseVisit.tsx";
import { LostReason } from "./LostReason.tsx";
import { VisitCode } from "./VisitCode.tsx";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.visits;

/** Where a visit stands: to come, by its stage; done, by how it was closed; else its status. */
function stateOf(visit: ClientVisit): string {
  const paid = visit.prepaid ? ` · ${copy.prepaid}` : "";
  if (visit.stage !== null) return `${copy.stages[visit.stage]}${paid}`;
  if (visit.outcome !== null) return copy.outcomes[visit.outcome];
  if (visit.status === "cancelled" || visit.status === "terminated") return copy.statuses[visit.status];
  return clients.unknown;
}

/** Booked or under way is still to happen; done is done; cancelled is quiet; a visit with no standing, a gap. */
function StateBadge({ visit }: { visit: ClientVisit }) {
  const words = stateOf(visit);
  if (words === clients.unknown) return <NoValue />;
  if (visit.stage !== null) return <Badge tone="attention">{words}</Badge>;
  return <Badge tone={visit.outcome === null ? "neutral" : "done"}>{words}</Badge>;
}

function whatOf(visit: ClientVisit): string {
  const kind = visit.type === null ? clients.unknown : copy.types[visit.type];
  return copy.what(kind, visit.service);
}

/** Ops closing a visit left partly done without a follow-up: who, when and why (docs/decisions/0092-task-owners.md). */
function ClosedWithoutFollowUp({ visit }: { visit: ClientVisit }) {
  const closed = visit.closed_without_follow_up;
  if (closed === null) return null;
  return (
    <span className={styles.closedLine}>
      {copy.closedWithout(whoWords(closed.by), longDate(closed.at))}
      {closed.reason === null ? "" : `: ${closed.reason}`}
    </span>
  );
}

type Change = "cancel" | "close";

/**
 * What ops may change of a visit to come: cancel it while it is ahead, or close it by hand once its time has come; one
 * nobody arrived at, either.
 */
function changesOf(
  visit: { readonly starts_at: string; readonly stage: ClientVisit["stage"] },
  now: number,
): readonly Change[] {
  if (visit.stage === null || visit.stage === "done") return [];
  if (Date.parse(visit.starts_at) > now) return visit.stage === "booked" ? ["cancel"] : [];
  return visit.stage === "missed" ? ["close", "cancel"] : ["close"];
}

const CALLS = { cancel: "POST /api/visits/{id}/cancel", close: "POST /api/visits/{id}/close" } as const;

/** A visit's own action in its row, and the panel it opens; a visit changed has the page read the record again. */
function ChangeVisit({ visit, name, onChanged }: { visit: ClientVisit; name: string; onChanged: () => void }) {
  const [open, setOpen] = useState<Change | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const access = useAccess();
  const changes = changesOf(visit, apiNow()).filter((change) => access.mayCall(CALLS[change]));
  if (changes.length === 0) return null;

  const when = plainDate(visit.date);
  const closed = (changed: boolean) => {
    setOpen(null);
    if (changed) onChanged();
    else requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <>
      {changes.map((change) => (
        <RowButton
          key={change}
          beside
          ref={change === open ? opener : undefined}
          aria-label={change === "cancel" ? copy.cancel.openLabel(when) : copy.handClose.openLabel(when)}
          onClick={() => {
            setOpen(change);
          }}
        >
          {change === "cancel" ? copy.cancel.open : copy.handClose.open}
        </RowButton>
      ))}
      {open === "cancel" && <CancelVisit visitId={visit.id} name={name} onClose={closed} />}
      {open === "close" && <CloseVisit visitId={visit.id} name={name} date={visit.date} onClose={closed} />}
    </>
  );
}

/** A visit to come on the dispatch board: its week, with its drawer open. */
function ShowOnBoard({ visit }: { visit: ClientVisit }) {
  const mayOpen = useAccess().mayCall("GET /api/dispatch");
  if (!mayOpen) return null;
  return (
    <OpsLink
      className={styles.boardLink}
      to={dispatchPath({ from: visit.date, visit: visit.id })}
      label={copy.onBoardLabel(plainDate(visit.date))}
    >
      {copy.onBoard}
    </OpsLink>
  );
}

/** The client whose visits the table lists, as the panels that change one name them, and what to do once one is. */
interface Changing {
  readonly name: string;
  readonly onChanged: () => void;
}

/** Where a row stands in the one table: past its day and not closed, to come, or done. */
type When = "overdue" | "upcoming" | "past";

interface Listed {
  readonly visit: ClientVisit;
  readonly when: When;
}

function VisitRow({
  listed,
  changing,
  lost,
}: {
  listed: Listed;
  changing: Changing;
  /** The reasons a closed consultation may be given; null where they are only shown. */
  lost: ClientRecord["lost_reasons"] | null;
}) {
  const { visit, when } = listed;
  const ahead = when !== "past";
  return (
    <tr className={rowRule(when === "overdue" ? "error" : undefined)}>
      <td>
        {plainDate(visit.date)}
        {ahead && <ShowOnBoard visit={visit} />}
      </td>
      <td>
        {whatOf(visit)}
        {visit.client_note !== null && <p className={styles.note}>{copy.clientNote(visit.client_note)}</p>}
      </td>
      <td>{visit.technician?.name ?? <NoValue />}</td>
      <td>{copy.time(indiaClock(visit.starts_at), indiaClock(visit.ends_at))}</td>
      <td>
        <StateBadge visit={visit} />
        <ClosedWithoutFollowUp visit={visit} />
        <LostReason visit={visit} reasons={ahead ? null : lost} onChanged={changing.onChanged} />
        {ahead && <ChangeVisit visit={visit} name={changing.name} onChanged={changing.onChanged} />}
      </td>
      <td>
        <VisitCode visit={visit} />
      </td>
    </tr>
  );
}

/** Bookings that refunded their payment by themselves, and why, so ops can answer a client who asks. */
function AutoRefunds({ refunds }: { refunds: readonly AutoRefund[] }) {
  if (refunds.length === 0) return null;
  const words = copy.autoRefunds;
  return (
    <section className={styles.visitList} aria-labelledby="auto-refunds">
      <h3 className={typeLook("title-4", styles.sectionTitle)} id="auto-refunds">
        {words.title}
      </h3>
      <ul className={styles.refundList}>
        {refunds.map((refund) => (
          <li key={refund.hold_id} className={styles.refundItem}>
            <p className={styles.refundWhat}>
              {words.what(
                copy.types[refund.type],
                plainDate(refund.date),
                refund.amount === null ? null : rupees(refund.amount),
              )}
            </p>
            <p className={styles.refundLine}>{words.why(longDate(refund.refunded_at), words.reasons[refund.reason])}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Nothing to come: what falls due next, the free visits a fitted client holds, and a way to book it. */
function NothingBooked({ record, booking }: { record: ClientRecord; booking: Booking }) {
  const next = record.next_visit;
  const kind = next === null ? null : copy.book.kinds[next.type];
  const due = next === null || kind === null ? null : copy.dueOn(kind, shortDate(next.due_on));
  const free = record.state === "fitted" ? copy.freeLeft(record.credits?.visits ?? 0) : null;
  const detail = [due, free].filter((line) => line !== null).join(" ");
  return (
    <EmptyState
      look="next"
      line={copy.nothingBooked}
      detail={detail === "" ? undefined : detail}
      action={
        booking.mayBook && (
          <Button
            variant="outline"
            size="small"
            onClick={(event) => {
              booking.open(event.currentTarget);
            }}
          >
            {kind === null ? copy.book.open : copy.bookKind(kind)}
          </Button>
        )
      }
    />
  );
}

export function Visits({
  record,
  booking,
  onChanged,
}: {
  record: ClientRecord;
  booking: Booking;
  /** A visit booked, cancelled or closed: the page reads the record again. */
  onChanged: () => void;
}) {
  return (
    <div className={styles.visits}>
      {record.visits.upcoming.length === 0 && <NothingBooked record={record} booking={booking} />}
      <VisitRecords visits={record.visits} name={record.name} onChanged={onChanged} lostReasons={record.lost_reasons} />
      <AutoRefunds refunds={record.auto_refunds} />
    </div>
  );
}

/** Every visit in one table: those past their day and not closed, which ops close by hand; those to come; then done. */
export function VisitRecords({
  visits,
  name,
  onChanged,
  lostReasons = null,
}: {
  visits: ClientRecord["visits"];
  /** Whose visits they are, as the panels that change one name them. */
  name: string;
  onChanged: () => void;
  /** What a closed consultation's reason may be set to; null on a page where it is only shown. */
  lostReasons?: ClientRecord["lost_reasons"] | null;
}) {
  const today = todayInIndia(apiNow());
  const rows: Listed[] = [
    ...visits.upcoming.map((visit) => ({
      visit,
      when: visit.date < today ? ("overdue" as const) : ("upcoming" as const),
    })),
    ...visits.past.map((visit) => ({ visit, when: "past" as const })),
  ].sort((a, b) => Number(b.when === "overdue") - Number(a.when === "overdue"));
  if (rows.length === 0) return null;
  return (
    <Panel titleId="client-visits" title={clients.tabs[0].label}>
      <Table fixed className={styles.visitTable}>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((listed) => (
            <VisitRow key={listed.visit.id} listed={listed} changing={{ name, onChanged }} lost={lostReasons} />
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
