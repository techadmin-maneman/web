// Board A3's card: the address with its access notes and Navigate, a way to
// reach the client, the piece on his head, and the last visit's after
// photograph. A job further out has none of it: the API withholds the address
// and the client until the day before, so the card says when they open.
//
// The last visit's photograph is fetched each time the card is open and never
// kept: the API answers it `no-store`, and the service worker leaves it alone.

import { Icon } from "@maneman/ui/Icon";
import type { Job } from "../api.ts";
import { job as copy } from "../content.ts";
import { PIN, STROKE } from "../icons.ts";
import { addressLine, callLink, wayTo, whatsAppLink } from "../lib/navigate.ts";
import { dayMonth, where } from "../lib/when.ts";
import styles from "./job.module.css";

type Piece = NonNullable<Job["pieces"]>[number];

/** "Rohit M." → "Rohit", as the board writes the name on the door. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** The piece on the client's head: the newest fitted one that has not failed. */
const onTheHead = (pieces: readonly Piece[]): Piece | null =>
  pieces.find((piece) => piece.fitted_at !== null && piece.failed_at === null) ?? null;

function PieceCard({ job }: { job: Job }) {
  const piece = onTheHead(job.pieces ?? []);
  const last = job.last_visit;
  return (
    <section className={styles.piece} aria-labelledby="piece-title">
      <h2 className={styles.pieceTitle} id="piece-title">
        {copy.piece.title}
      </h2>
      {piece === null ? (
        <p className={styles.pieceNone}>{copy.piece.none}</p>
      ) : (
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={styles.rowKey}>{copy.piece.rows.piece}</dt>
            <dd className={styles.rowValue}>{piece.piece_code}</dd>
          </div>
          {piece.base !== null && (
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.base}</dt>
              <dd className={styles.rowValue}>{piece.base}</dd>
            </div>
          )}
          {piece.supplier_lot !== null && (
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.lot}</dt>
              <dd className={styles.rowValue}>{piece.supplier_lot}</dd>
            </div>
          )}
          {piece.fitted_at !== null && (
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.fitted}</dt>
              <dd className={styles.rowValue}>{dayMonth(piece.fitted_at)}</dd>
            </div>
          )}
          {piece.replacement_due_at !== null && (
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.due}</dt>
              <dd className={styles.rowValue}>{dayMonth(piece.replacement_due_at)}</dd>
            </div>
          )}
        </dl>
      )}
      {last !== null && (
        <div className={styles.lastVisit}>
          <img className={styles.lastVisitPhoto} src={last.photo_url} alt={copy.piece.lastVisitImage} />
          <p className={styles.lastVisitLine}>{copy.piece.lastVisit(dayMonth(last.date), last.technician)}</p>
        </div>
      )}
    </section>
  );
}

export function JobCard({ job }: { job: Job }) {
  if (job.address === null) {
    return (
      <section className={styles.locked}>
        <p className={styles.lockedTitle}>{copy.locked.title}</p>
        <p className={styles.lockedBody}>{copy.locked.body}</p>
        <p className={styles.sector}>{where(job.sector)}</p>
      </section>
    );
  }

  const client = job.client;
  /** What the client asked the technician to know, from their app (REQ-04). */
  const clientNote = client?.note ?? null;
  return (
    <>
      <section className={styles.address}>
        <p className={styles.line}>{addressLine(job.address)}</p>
        {job.address.landmark !== null && job.address.landmark.trim() !== "" && (
          <p className={styles.access}>{copy.near(job.address.landmark)}</p>
        )}
        {job.access_notes !== null && <p className={styles.access}>{job.access_notes}</p>}
        {client !== null && clientNote !== null && (
          <p className={styles.access}>{copy.clientNote(firstName(client.name), clientNote)}</p>
        )}
        {/* A new tab, so a technician who has taken the route back still has the app open behind it. */}
        <a className={styles.navigate} href={wayTo(job.address)} target="_blank" rel="noopener noreferrer">
          <Icon d={PIN} size={21} stroke={STROKE} />
          <span>{copy.navigate}</span>
        </a>
        {client !== null && (
          <div className={styles.reach}>
            <a className={styles.reachLink} href={callLink(client.mobile)}>
              {copy.call(firstName(client.name))}
            </a>
            <a
              className={styles.reachLink}
              href={whatsAppLink(client.mobile)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.whatsApp(firstName(client.name))}
            </a>
          </div>
        )}
      </section>
      <PieceCard job={job} />
    </>
  );
}
