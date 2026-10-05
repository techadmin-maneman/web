// Board A3's card: the address with its access notes and Navigate, a way to
// reach the client, their hair profile, the piece, and the last visit's after
// photograph. A job further out has none of it: the API withholds the address
// and the client until the day before, so the card says when they open.
//
// The hair profile gives the board's tier, colour, adhesive and scalp, with the
// base's size, where one is recorded; the board's template is recorded nowhere,
// so it is not drawn. The piece says what the client paid for, warns when the
// profile names another product, and gives the piece on the client's head. A
// consultation fits nothing, so its card has no piece.
//
// The last visit's photograph is fetched each time the card is open and never
// kept: the API answers it `no-store`, and the service worker leaves it alone.

import { capsLook } from "@maneman/ui/Caps";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { addressLine } from "@maneman/web-kit/address";
import type { HairProfile, Job } from "../api.ts";
import { job as copy, profile as profileCopy } from "../content.ts";
import { PIN, STROKE } from "../icons.ts";
import { callLink, wayTo } from "../lib/navigate.ts";
import { dayMonth, where } from "../lib/when.ts";
import { paidFor, profileNamesAnother } from "../lib/paid-for.ts";
import styles from "./job.module.css";
import { firstNameOf } from "../../../../src/lib/names.ts";

type Piece = NonNullable<Job["pieces"]>[number];

/** "Rohit M." → "Rohit", as the board writes the name on the door. */

/** The piece on the client's head: the newest fitted one that has not failed. */
const onTheHead = (pieces: readonly Piece[]): Piece | null =>
  pieces.find((piece) => piece.fitted_at !== null && piece.failed_at === null) ?? null;

interface Line {
  readonly key: string;
  readonly value: string;
}

/** The board's rows the profile answers, each only where it is recorded. */
function profileLines(profile: HairProfile | null): Line[] {
  if (profile === null) return [];
  const { fit, history } = profile;
  const scalp = history?.skin_and_allergies ?? null;
  const rows = profileCopy.card;
  const lines: (Line | null)[] = [
    fit.product_name === null ? null : { key: rows.tier, value: fit.product_name },
    fit.base_width_in === null || fit.base_length_in === null
      ? null
      : { key: rows.baseSize, value: rows.size(fit.base_width_in, fit.base_length_in) },
    fit.colour === null
      ? null
      : { key: rows.colour, value: rows.shade(profileCopy.colours[fit.colour], fit.grey_percent) },
    fit.attachment === null ? null : { key: rows.adhesive, value: profileCopy.attachments[fit.attachment] },
    scalp === null ? null : { key: rows.scalp, value: scalp },
  ];
  return lines.filter((line) => line !== null);
}

function Rows({ lines }: { lines: readonly Line[] }) {
  return (
    <dl className={styles.rows}>
      {lines.map((line) => (
        <div className={styles.row} key={line.key}>
          <dt className={styles.rowKey}>{line.key}</dt>
          <dd className={styles.rowValue}>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileCard({ profile }: { profile: HairProfile | null }) {
  const lines = profileLines(profile);
  if (lines.length === 0) return null;
  return (
    <section className={styles.piece} aria-labelledby="profile-title">
      <h2 className={capsLook(styles.pieceTitle)} id="profile-title">
        {copy.profileTitle}
      </h2>
      <Rows lines={lines} />
    </section>
  );
}

function PieceCard({ job }: { job: Job }) {
  const piece = onTheHead(job.pieces ?? []);
  const paid = paidFor(job);
  const inProfile = profileNamesAnother(job);
  return (
    <section className={styles.piece} aria-labelledby="piece-title">
      <h2 className={capsLook(styles.pieceTitle)} id="piece-title">
        {copy.piece.title}
      </h2>
      {paid !== null && <Rows lines={[{ key: copy.piece.rows.paidFor, value: paid }]} />}
      {inProfile !== null && <p className={styles.pieceWarn}>{copy.piece.mismatch(inProfile)}</p>}
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
    </section>
  );
}

function LastVisit({ last }: { last: NonNullable<Job["last_visit"]> }) {
  return (
    <section className={styles.piece}>
      <div className={styles.lastVisit}>
        <img className={styles.lastVisitPhoto} src={last.photo_url} alt={copy.piece.lastVisitImage} />
        <p className={styles.lastVisitLine}>{copy.piece.lastVisit(dayMonth(last.date), last.technician)}</p>
      </div>
    </section>
  );
}

export function JobCard({ job }: { job: Job }) {
  if (job.address === null) {
    return (
      <section className={styles.locked}>
        <p className={capsLook(styles.lockedTitle)}>{copy.locked.title}</p>
        <p className={styles.lockedBody}>{copy.locked.opens(job.unlocks_at)}</p>
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
          <dl className={styles.landmark}>
            <dt className={styles.landmarkLabel}>{copy.landmark}</dt>
            <dd className={styles.access}>{job.address.landmark}</dd>
          </dl>
        )}
        {job.access_notes !== null && <p className={styles.access}>{job.access_notes}</p>}
        {client !== null && clientNote !== null && (
          <p className={styles.access}>{copy.clientNote(firstNameOf(client.name), clientNote)}</p>
        )}
        {/* A new tab, so a technician who has taken the route back still has the app open behind it. */}
        <a className={styles.navigate} href={wayTo(job.address)} target="_blank" rel="noopener noreferrer">
          <Icon d={PIN} size={21} stroke={STROKE} />
          <span>{copy.navigate}</span>
        </a>
        {client !== null && (
          <div className={styles.reach}>
            <a className={styles.reachLink} href={callLink(client.mobile)}>
              {copy.call(firstNameOf(client.name))}
            </a>
            <a
              className={styles.reachLink}
              href={whatsappChat(client.mobile)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.whatsApp(firstNameOf(client.name))}
            </a>
          </div>
        )}
      </section>
      <ProfileCard profile={job.profile} />
      {job.type !== "consultation" && <PieceCard job={job} />}
      {job.last_visit !== null && <LastVisit last={job.last_visit} />}
    </>
  );
}
