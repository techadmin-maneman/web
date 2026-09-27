// The client's Visits tab: where their visits go, and every visit to come and
// done. The board draws the tab and nothing in it, so it is built as board
// B1's own table is. The record already holds all of it, so the tab asks the
// API for nothing (docs/fidelity-method.md).

import { Table } from "@maneman/ui/Table";
import { fullDate, indiaClock } from "@maneman/web-kit/dates";
import type { ClientRecord, ClientVisit } from "../api.ts";
import { clients } from "../content.ts";
import styles from "./clients.module.css";

const copy = clients.visits;

/** Where a visit stands: to come, by its stage; done, by how FSM closed it; else its status. */
function stateOf(visit: ClientVisit): string {
  const paid = visit.prepaid ? ` · ${copy.prepaid}` : "";
  if (visit.stage !== null) return `${copy.stages[visit.stage]}${paid}`;
  if (visit.outcome !== null) return copy.outcomes[visit.outcome];
  return copy.statuses[visit.status] ?? clients.unknown;
}

function Address({ address }: { address: ClientRecord["address"] }) {
  if (address === null) return <p className={styles.note}>{copy.noAddress}</p>;
  const lines = [address.line1, address.line2, `${address.locality}, ${address.city} ${address.pincode}`];
  return (
    <dl className={styles.address}>
      <div className={styles.addressRow}>
        <dt className={styles.metaKey}>{copy.address}</dt>
        <dd className={styles.addressValue}>{lines.filter((line) => line !== null && line !== "").join(", ")}</dd>
      </div>
      {address.access_notes !== null && (
        <div className={styles.addressRow}>
          <dt className={styles.metaKey}>{copy.access}</dt>
          <dd className={styles.addressValue}>{address.access_notes}</dd>
        </div>
      )}
    </dl>
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
                <td className={styles.cell}>{stateOf(visit)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

export function Visits({ record }: { record: ClientRecord }) {
  return (
    <div className={styles.visits}>
      <Address address={record.address} />
      <VisitTable title={copy.upcoming} visits={record.visits.upcoming} empty={copy.noUpcoming} />
      <VisitTable title={copy.past} visits={record.visits.past} empty={copy.noPast} />
    </div>
  );
}
