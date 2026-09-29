// The client's Visits tab: where their visits go, and every visit to come and
// done. The board draws the tab and nothing in it, so it is built as board
// B1's own table is. The record already holds all of it, so the tab asks the
// API for nothing (docs/fidelity-method.md), but to save an address the client
// gives ops on the phone (GivenAddress.tsx; docs/decisions/0092-task-owners.md)
// and to act on a booking FSM refused, which heads the tab while it waits
// (HeldBookings.tsx; docs/decisions/0095-a-booking-fsm-refuses-is-held.md).

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { fullDate, indiaClock, longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { ClientRecord, ClientVisit } from "../api.ts";
import { clients } from "../content.ts";
import styles from "./clients.module.css";
import { GivenAddressForm } from "./GivenAddress.tsx";
import { HeldBookings } from "./HeldBookings.tsx";

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

function VisitTable({ title, visits, empty }: { title: string; visits: readonly ClientVisit[]; empty: string }) {
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
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

export function Visits({
  clientId,
  record,
  address,
  onAddress,
}: {
  clientId: string;
  record: ClientRecord;
  /** The address visits go to, the one saved on this page since it opened if there is one. */
  address: ClientRecord["address"];
  onAddress: (address: SavedAddress) => void;
}) {
  return (
    <div className={styles.visits}>
      <HeldBookings bookings={record.held_bookings} upcoming={record.visits.upcoming} />
      <Address clientId={clientId} address={address} onAddress={onAddress} />
      <VisitTable title={copy.upcoming} visits={record.visits.upcoming} empty={copy.noUpcoming} />
      <VisitTable title={copy.past} visits={record.visits.past} empty={copy.noPast} />
    </div>
  );
}
