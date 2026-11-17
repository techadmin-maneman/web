// The job in the new look (docs/prompts/tech-redesign.md, "Job"; docs/decisions/0243-job-and-the-door.md): the map's
// place, the address and its landmark, the way in with Copy, the client's note, then Navigate, Call and Message; the
// client's record; the client block the prototype draws for the kind of visit (docs/decisions/0270-the-design-checks-
// api-side.md), and a consultation's options. A job further out has none of it: the API withholds the address and the
// client until the day before, so the job says when they open.

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
import { badges, job as copy, options as optionsCopy, profile as profileCopy } from "../content.ts";
import { theirs } from "../lang/index.ts";
import { dayMonth, todayInIndia, where } from "../lib/when.ts";
import { keptDay } from "../store/jobs.ts";
import { HowDone } from "../guides/index.ts";
import { screensOf } from "../visit/index.ts";
import { ClientRecord } from "./ClientRecord.tsx";
import { Reschedule } from "./Reschedule.tsx";
import { TellClient } from "./TellClient.tsx";
import styles from "./job-card.module.css";
import { Chevron } from "../frame/Chevron.tsx";

interface Line {
  readonly key: string;
  readonly value: string;
}

/** The base's size, the colour and how the hair system is fixed, each only where the profile records it. */
function fitLines(fit: HairProfile["fit"]): (Line | null)[] {
  const rows = profileCopy.card;
  return [
    fit.base_width_in === null || fit.base_length_in === null
      ? null
      : { key: rows.base, value: rows.size(fit.base_width_in, fit.base_length_in) },
    fit.colour === null
      ? null
      : { key: rows.colour, value: rows.shade(profileCopy.colours[fit.colour], fit.grey_percent) },
    fit.attachment === null ? null : { key: rows.fixing, value: profileCopy.attachments[fit.attachment] },
  ];
}

/**
 * The profile's rows as the prototype lists them: on a first fit what the consultation chose and the Norwood stage,
 * then the fit; on any other visit the hair system, the fit and the scalp.
 */
function profileLines({ fit, history }: HairProfile, firstFit: boolean): Line[] {
  const rows = profileCopy.card;
  const product =
    fit.product_name === null ? null : { key: firstFit ? rows.chose : rows.tier, value: fit.product_name };
  const scalp = history?.skin_and_allergies ?? null;
  const lines = firstFit
    ? [product, fit.norwood_stage === null ? null : { key: rows.norwood, value: fit.norwood_stage }, ...fitLines(fit)]
    : [product, ...fitLines(fit), scalp === null ? null : { key: rows.scalp, value: scalp }];
  return lines.filter((line) => line !== null);
}

interface Block {
  readonly title: string;
  readonly meta: string | null;
  readonly lines: Line[];
}

/**
 * The client block the prototype draws for the kind of visit: a consultation's booking, where it was made and how it
 * is paid; a first fit's profile from the consultation, dated; any other visit's hair profile, with its last visit.
 */
function blockOf(job: Job): Block | null {
  if (job.type === "consultation") {
    const words = copy.booking;
    const via = job.booked_via === null ? null : { key: words.bookedVia, value: words.via[job.booked_via] };
    const paid = { key: words.payment, value: badges[job.badge] };
    return { title: words.title, meta: null, lines: via === null ? [paid] : [via, paid] };
  }
  const profile = job.profile;
  if (profile === null) return null;
  if (job.type === "first_fit") {
    const recorded = dayMonth(todayInIndia(new Date(profile.recorded_at)));
    return { title: copy.fromConsultation, meta: recorded, lines: profileLines(profile, true) };
  }
  const last = job.last_visit === null ? null : copy.lastVisitOn(dayMonth(job.last_visit.date));
  return { title: copy.profileTitle, meta: last, lines: profileLines(profile, false) };
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

/** The drive to the job, its minutes and km, from the day's list the phone keeps; null where it does not know it. */
function useDrive(job: Job): { readonly minutes: number | null; readonly km: number | null } {
  const read = useCallback(async () => {
    const listed = (await keptDay(job.date))?.find((each) => each.id === job.id);
    return { minutes: listed?.drive_minutes ?? null, km: listed?.drive_km ?? null };
  }, [job.date, job.id]);
  return valueOr(useAsync(read)[0], { minutes: null, km: null });
}

/** Where a map will be: the drive there, or that the address has no pin to show. */
function MapSlot({ job }: { job: Job }) {
  const drive = useDrive(job);
  const pinned = job.address?.lat !== null;
  return (
    <div className={styles.map} role="img" aria-label={pinned ? copy.map.label : copy.map.noPin}>
      <Icon className={styles.mapIcon} d={GLYPHS.navigate} size="md" />
      <span className={styles.mapLine}>{pinned ? copy.map.line(drive.minutes, drive.km) : copy.map.noPin}</span>
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

function ClientBlock({ job }: { job: Job }) {
  const block = blockOf(job);
  if (block === null || block.lines.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="client-block-title">
      <SectionHead
        title={block.title}
        size="list"
        id="client-block-title"
        {...(block.meta === null ? {} : { end: block.meta })}
      />
      <Rows lines={block.lines} />
    </section>
  );
}

export function JobCard({ job }: { job: Job }) {
  if (job.address === null) {
    // A past visit's card has locked again, and opens no more: only one to come opens, at its hour.
    const past = job.day === "past";
    return (
      <section className={styles.locked}>
        <p className={styles.lockedTitle}>{past ? copy.locked.pastTitle : copy.locked.title}</p>
        <p className={styles.lockedBody}>{past ? copy.locked.past : copy.locked.opens(job.unlocks_at)}</p>
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
            <span className={styles.noteFrom}>{copy.noteFrom(theirs(firstNameOf(client.name)))}</span>
            {note}
          </p>
        )}
        <TellClient job={job} />
        <Reschedule job={job} />
      </section>
      <ClientRecord job={job} />
      <ClientBlock job={job} />
      {job.type === "consultation" && (
        <ListRows className={styles.rowList}>
          <ListRow title={optionsCopy.link} to={`/jobs/${job.id}/options`} end={<Chevron />} />
        </ListRows>
      )}
      {/* Last, as the prototype orders the card: the way the visit is done, its steps counted. */}
      {job.type !== null && <HowDone to={`/guides/${job.type}`} steps={screensOf(job).length} />}
    </>
  );
}
