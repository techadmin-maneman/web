// The client's Visits tab: where their visits go, and every visit to come and
// done. The board draws the tab and nothing in it, so it is built as board
// B1's own table is. The record already holds all of it, so the tab asks the
// API for nothing (docs/fidelity-method.md), but to save an address the client
// gives ops on the phone (GivenAddress.tsx; docs/decisions/0092-task-owners.md)
// and to act on a booking FSM refused, which heads the tab while it waits
// (HeldBookings.tsx; docs/decisions/0095-a-booking-fsm-refuses-is-held.md),
// and to enter a discount code on a visit or take it off (VisitCode.tsx;
// docs/decisions/0108-discount-codes.md), to book the client a visit (BookVisit.tsx), and to cancel a visit to come
// (CancelVisit.tsx) or close by hand one whose technician's phone was lost (CloseVisit.tsx). Beneath the visits, any
// booking that refunded its payment by itself, and why.

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { fullDate, indiaClock, longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useRef, useState } from "react";
import type { AutoRefund, ClientRecord, ClientVisit } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";
import { BookVisit } from "./BookVisit.tsx";
import { CancelVisit } from "./CancelVisit.tsx";
import { CloseVisit } from "./CloseVisit.tsx";
import { GivenAddressForm } from "./GivenAddress.tsx";
import { HeldBookings } from "./HeldBookings.tsx";
import { VisitCode } from "./VisitCode.tsx";

type SavedAddress = NonNullable<ClientRecord["address"]>;

const copy = clients.visits;

/** Where a visit stands: to come, by its stage; done, by how FSM closed it; else its status. */
function stateOf(visit: ClientVisit): string {
  const paid = visit.prepaid ? ` · ${copy.prepaid}` : "";
  if (visit.stage !== null) return `${copy.stages[visit.stage]}${paid}`;
  if (visit.outcome !== null) return copy.outcomes[visit.outcome];
  return copy.statuses[visit.status] ?? clients.unknown;
}

/** The address on one line, narrowest part first, as the client app writes it. */
function written(address: SavedAddress): string {
  const parts = [address.flat, address.floor, address.tower, address.building, address.line1, address.line2];
  const given = parts.filter((part): part is string => part !== null && part !== "");
  return [...new Set(given), `${address.locality}, ${address.city} ${address.pincode}`].join(", ");
}

function AddressRows({ address }: { address: SavedAddress }) {
  const rows = [
    { key: copy.address, value: written(address) },
    ...(address.landmark === null ? [] : [{ key: copy.landmark, value: address.landmark }]),
    ...(address.access_notes === null ? [] : [{ key: copy.access, value: address.access_notes }]),
    ...(address.given_to_ops === null
      ? []
      : [{ key: copy.givenToOps, value: copy.givenTo(address.given_to_ops.by, longDate(address.given_to_ops.at)) }]),
  ];
  return (
    <dl className={styles.address}>
      {rows.map((row) => (
        <div className={styles.addressRow} key={row.key}>
          <dt className={styles.metaKey}>{row.key}</dt>
          <dd className={styles.addressValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Address({
  clientId,
  address,
  onAddress,
}: {
  clientId: string;
  address: ClientRecord["address"];
  onAddress: (address: SavedAddress) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mayRecord = useAccess().mayCall("POST /api/clients/{id}/address");

  if (recording) {
    return (
      <GivenAddressForm
        clientId={clientId}
        onSaved={(given) => {
          onAddress(given);
          setRecording(false);
          setSaved(true);
          requestAnimationFrame(() => opener.current?.focus());
        }}
        onCancel={() => {
          setRecording(false);
          requestAnimationFrame(() => opener.current?.focus());
        }}
      />
    );
  }
  return (
    <div>
      {address === null ? <p className={styles.note}>{copy.noAddress}</p> : <AddressRows address={address} />}
      {saved && (
        <p className={styles.done} role="status">
          {copy.given.saved}
        </p>
      )}
      {mayRecord && (
        <Button
          variant="outline"
          size="small"
          ref={opener}
          className={styles.secondary}
          onClick={() => {
            setSaved(false);
            setRecording(true);
          }}
        >
          {address === null ? copy.given.open : copy.given.change}
        </Button>
      )}
    </div>
  );
}

/** Ops closing a visit left partly done without a follow-up: who, when and why (docs/decisions/0092-task-owners.md). */
function ClosedWithoutFollowUp({ visit }: { visit: ClientVisit }) {
  const closed = visit.closed_without_follow_up;
  if (closed === null) return null;
  return (
    <span className={styles.closedLine}>
      {copy.closedWithout(closed.by, longDate(closed.at))}
      {closed.reason === null ? "" : `: ${closed.reason}`}
    </span>
  );
}

/** What ops may change of a visit to come: cancel it while it is ahead, or close it by hand once its time has come. */
function changesOf(
  visit: { readonly starts_at: string; readonly stage: ClientVisit["stage"] },
  now: number,
): "cancel" | "close" | null {
  if (visit.stage === null || visit.stage === "done") return null;
  if (Date.parse(visit.starts_at) > now) return visit.stage === "booked" ? "cancel" : null;
  return "close";
}

/** A visit's own action in its row, and the panel it opens; a visit changed has the page read the record again. */
function ChangeVisit({ visit, name, onChanged }: { visit: ClientVisit; name: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const access = useAccess();
  const change = changesOf(visit, Date.now());
  if (change === null) return null;
  const call = change === "cancel" ? "POST /api/visits/{id}/cancel" : "POST /api/visits/{id}/close";
  if (!access.mayCall(call)) return null;

  const when = fullDate(visit.date);
  const closed = (changed: boolean) => {
    setOpen(false);
    if (changed) onChanged();
    else requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <>
      <Button
        variant="outline"
        size="small"
        ref={opener}
        className={styles.secondary}
        aria-label={change === "cancel" ? copy.cancel.openLabel(when) : copy.handClose.openLabel(when)}
        onClick={() => {
          setOpen(true);
        }}
      >
        {change === "cancel" ? copy.cancel.open : copy.handClose.open}
      </Button>
      {open && change === "cancel" && <CancelVisit visitId={visit.id} name={name} onClose={closed} />}
      {open && change === "close" && <CloseVisit visitId={visit.id} name={name} date={visit.date} onClose={closed} />}
    </>
  );
}

/** The client whose visits a table lists, where its rows may be changed: only the visits to come. */
interface Changing {
  readonly name: string;
  readonly onChanged: () => void;
}

function VisitTable({
  title,
  visits,
  empty,
  changing = null,
}: {
  title: string;
  visits: readonly ClientVisit[];
  empty: string;
  changing?: Changing | null;
}) {
  return (
    <section className={styles.visitList} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {visits.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <Table className={styles.table}>
          <thead>
            <tr>
              {copy.columns.map((column) => (
                <th key={column} scope="col" className={styles.cell}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.id}>
                <td className={styles.cell}>{fullDate(visit.date)}</td>
                <td className={styles.cell}>{copy.time(indiaClock(visit.starts_at), indiaClock(visit.ends_at))}</td>
                <td className={styles.cell}>{visit.type === null ? clients.unknown : copy.types[visit.type]}</td>
                <td className={styles.quietCell}>{visit.technician?.name ?? clients.unknown}</td>
                <td className={styles.cell}>
                  {stateOf(visit)}
                  <ClosedWithoutFollowUp visit={visit} />
                  {changing !== null && (
                    <ChangeVisit visit={visit} name={changing.name} onChanged={changing.onChanged} />
                  )}
                </td>
                <td className={styles.cell}>
                  <VisitCode visit={visit} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

/** Bookings that refunded their payment by themselves, and why, so ops can answer a client who asks. */
function AutoRefunds({ refunds }: { refunds: readonly AutoRefund[] }) {
  if (refunds.length === 0) return null;
  const words = copy.autoRefunds;
  return (
    <section className={styles.visitList} aria-labelledby="auto-refunds">
      <h3 className={styles.sectionTitle} id="auto-refunds">
        {words.title}
      </h3>
      <ul className={styles.heldList}>
        {refunds.map((refund) => (
          <li key={refund.hold_id} className={styles.heldItem}>
            <p className={styles.heldWhat}>
              {words.what(
                copy.types[refund.type],
                fullDate(refund.date),
                refund.amount === null ? null : rupees(refund.amount),
              )}
            </p>
            <p className={styles.heldLine}>{words.why(longDate(refund.refunded_at), words.reasons[refund.reason])}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Book a visit, and the panel it opens; a visit booked, or a link sent, has the page read the record again. */
function BookOne({ clientId, record, onBooked }: { clientId: string; record: ClientRecord; onBooked: () => void }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mayBook = useAccess().mayCall("POST /api/visits");
  if (!mayBook) return null;
  return (
    <>
      <Button
        variant="primary"
        size="small"
        ref={opener}
        className={styles.primary}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.book.open}
      </Button>
      {open && (
        <BookVisit
          clientId={clientId}
          name={record.name}
          prefill={{ choice: record.state === "fitted" ? "service" : "consultation" }}
          onClose={(booked) => {
            setOpen(false);
            if (booked !== null) onBooked();
            else requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      )}
    </>
  );
}

export function Visits({
  clientId,
  record,
  address,
  onAddress,
  onChanged,
}: {
  clientId: string;
  record: ClientRecord;
  /** The address visits go to, the one saved on this page since it opened if there is one. */
  address: ClientRecord["address"];
  onAddress: (address: SavedAddress) => void;
  /** A visit booked, cancelled or closed: the page reads the record again. */
  onChanged: () => void;
}) {
  return (
    <div className={styles.visits}>
      <BookOne clientId={clientId} record={record} onBooked={onChanged} />
      <HeldBookings bookings={record.held_bookings} upcoming={record.visits.upcoming} />
      <Address clientId={clientId} address={address} onAddress={onAddress} />
      <VisitTable
        title={copy.upcoming}
        visits={record.visits.upcoming}
        empty={copy.noUpcoming}
        changing={{ name: record.name, onChanged }}
      />
      <VisitTable title={copy.past} visits={record.visits.past} empty={copy.noPast} />
      <AutoRefunds refunds={record.auto_refunds} />
    </div>
  );
}
