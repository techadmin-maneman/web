// The job in the new look (docs/prompts/tech-redesign.md, "Job"; docs/decisions/0243-job-and-the-door.md): the map's
// place, the address and its landmark, the way in with Copy, the client's note, then Navigate, Call and Message; the
// client's record; their hair profile, and the piece on their head or a consultation's options; and the last visit's
// after photograph. A job further out has none of it: the API withholds the address and the client until the day
// before, so the job says when they open.
//
// The last visit's photograph is fetched each time the job is open and never kept: the API answers it `no-store`, and
// the service worker leaves it alone.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { IconButton } from "@maneman/ui/IconButton";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { addressLine } from "@maneman/web-kit/address";
import { firstNameOf } from "@rules/lib/names.ts";
import { useCallback, useState } from "react";
import type { HairProfile, Job } from "../api.ts";
import { job as copy, options as optionsCopy, profile as profileCopy } from "../content.ts";
import { paidFor, profileNamesAnother } from "../lib/paid-for.ts";
import { dayMonth, where } from "../lib/when.ts";
import { keptDay } from "../store/jobs.ts";
import { ClientRecord } from "./ClientRecord.tsx";
import { TellClient } from "./TellClient.tsx";
import styles from "./job-card.module.css";

type Piece = NonNullable<Job["pieces"]>[number];

/** The piece on the client's head: the newest fitted one that has not failed or been replaced. */
const onTheHead = (pieces: readonly Piece[]): Piece | null =>
  pieces.find((piece) => piece.fitted_at !== null && piece.failed_at === null && piece.replaced_at === null) ?? null;

interface Line {
  readonly key: string;
  readonly value: string;
}

/** The profile's rows, each only where it is recorded. */
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

/** The piece's rows: what it is, its base and lot, and when it was fitted and is due to be replaced. */
function pieceLines(piece: Piece): Line[] {
  const rows = copy.piece.rows;
  const lines: (Line | null)[] = [
    { key: rows.piece, value: piece.piece_code },
    piece.base === null ? null : { key: rows.base, value: piece.base },
    piece.supplier_lot === null ? null : { key: rows.lot, value: piece.supplier_lot },
    piece.fitted_at === null ? null : { key: rows.fitted, value: dayMonth(piece.fitted_at) },
    piece.replacement_due_at === null ? null : { key: rows.due, value: dayMonth(piece.replacement_due_at) },
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

/** The drive to the job, from the day's list the phone keeps; null where it does not know it. */
function useDrive(job: Job): number | null {
  const read = useCallback(
    async () => (await keptDay(job.date))?.find((each) => each.id === job.id)?.drive_minutes ?? null,
    [job.date, job.id],
  );
  return valueOr(useAsync(read)[0], null);
}

/** Where a map will be: the drive there, or that the address has no pin to show. */
function MapSlot({ job }: { job: Job }) {
  const drive = useDrive(job);
  const pinned = job.address?.lat !== null;
  return (
    <div className={styles.map} role="img" aria-label={pinned ? copy.map.label : copy.map.noPin}>
      <Icon className={styles.mapIcon} d={GLYPHS.navigate} size="md" />
      <span className={styles.mapLine}>{pinned ? copy.map.line(drive) : copy.map.noPin}</span>
    </div>
  );
}

/** The way in from the access notes, with Copy for a gate's keypad. */
function WayIn({ notes }: { notes: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.wayIn}>
      <p className={styles.wayInText}>{notes}</p>
      <IconButton
        className={styles.copy}
        d={GLYPHS.copy}
        size="lg"
        label={copy.copyWayIn}
        onClick={() => {
          void navigator.clipboard.writeText(notes).then(() => {
            setCopied(true);
          });
        }}
      />
      <span className={styles.copied} role="status">
        {copied ? copy.copied : ""}
      </span>
    </div>
  );
}

function ProfileSection({ profile }: { profile: HairProfile | null }) {
  const lines = profileLines(profile);
  if (lines.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="profile-title">
      <SectionHead title={copy.profileTitle} size="list" id="profile-title" />
      <Rows lines={lines} />
    </section>
  );
}

/** What the client paid for, a warning where the profile names another product, and the piece on their head. */
function PieceSection({ job }: { job: Job }) {
  const piece = onTheHead(job.pieces ?? []);
  const paid = paidFor(job);
  const inProfile = profileNamesAnother(job);
  return (
    <section className={styles.section} aria-labelledby="piece-title">
      <SectionHead title={copy.piece.title} size="list" id="piece-title" />
      {paid !== null && <Rows lines={[{ key: copy.piece.rows.paidFor, value: paid }]} />}
      {inProfile !== null && <p className={styles.warn}>{copy.piece.mismatch(inProfile)}</p>}
      {piece === null ? <p className={styles.none}>{copy.piece.none}</p> : <Rows lines={pieceLines(piece)} />}
    </section>
  );
}

function LastVisit({ last }: { last: NonNullable<Job["last_visit"]> }) {
  return (
    <section className={styles.lastVisit}>
      <img className={styles.lastVisitPhoto} src={last.photo_url} alt={copy.piece.lastVisitImage} />
      <p className={styles.lastVisitLine}>{copy.piece.lastVisit(dayMonth(last.date), last.technician)}</p>
    </section>
  );
}

export function JobCard({ job }: { job: Job }) {
  if (job.address === null) {
    return (
      <section className={styles.locked}>
        <p className={styles.lockedTitle}>{copy.locked.title}</p>
        <p className={styles.lockedBody}>{copy.locked.opens(job.unlocks_at)}</p>
        <p className={styles.sector}>{where(job.sector)}</p>
      </section>
    );
  }
  const client = job.client;
  const note = client?.note ?? null;
  const landmark = job.address.landmark?.trim() ?? "";
  return (
    <>
      <MapSlot job={job} />
      <section className={styles.place}>
        <p className={styles.address}>{addressLine(job.address)}</p>
        {landmark !== "" && <p className={styles.landmark}>{landmark}</p>}
        {job.access_notes !== null && <WayIn notes={job.access_notes} />}
        {client !== null && note !== null && (
          <p className={styles.note}>
            <span className={styles.noteFrom}>{copy.noteFrom(firstNameOf(client.name))}</span>
            {note}
          </p>
        )}
        <TellClient job={job} />
      </section>
      <ClientRecord job={job} />
      <ProfileSection profile={job.profile} />
      {job.type === "consultation" ? (
        <ListRows className={styles.rowList}>
          <ListRow
            title={optionsCopy.link}
            to={`/jobs/${job.id}/options`}
            end={<Icon d={GLYPHS.chevron} size="sm" />}
          />
        </ListRows>
      ) : (
        <PieceSection job={job} />
      )}
      {job.last_visit !== null && <LastVisit last={job.last_visit} />}
    </>
  );
}
