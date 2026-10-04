// Board A1's unassigned tray: the jobs nobody holds yet, each with the client,
// the kind of visit, the window the client asked for beside the one offered,
// and who invited the client, where someone did (the brief's "referral
// source"). A job still on a technician who was switched off waits here too,
// saying whose it was. The asked window is what the client picked; a visit whose booking
// recorded none says so rather than repeating the offered one, and the asked
// window carries no day, since none was recorded with it (ADR 0063). An
// offered window that is not the one asked for is lettered in oxblood, as the
// board draws it. An empty tray folds to a rail, so a laptop's width goes to
// the week's days.

import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { shortDate } from "@maneman/web-kit/dates";
import type { BookingWindow, Unassigned } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { nameOf, type Job } from "./job.ts";

const windowWord = (window: BookingWindow | null) =>
  window === null ? dispatch.unknown : (dispatch.windows[window] ?? window);

/** "Sat, evening", as the tray writes the day and window offered. */
const offeredWord = (date: string | null, window: BookingWindow | null) =>
  date === null ? windowWord(window) : `${shortDate(date).slice(0, 3)}, ${windowWord(window)}`;

/** The asked window, or the tray's words for a booking that recorded none. */
const askedWord = (each: Unassigned) =>
  each.asked_window === null ? dispatch.tray.notAsked : dispatch.tray.asked(windowWord(each.asked_window));

/** The client asked for one window and is being offered another. */
const isOtherThanAsked = (each: Unassigned) => each.asked_window !== null && each.asked_window !== each.offered_window;

function TrayLines({ each }: { each: Unassigned }) {
  const referredBy = each.person === null ? null : each.person.referred_by;
  return (
    <>
      <span className={styles.trayTop}>
        <span>{each.person?.name ?? nameOf({ kind: "unassigned", job: each })}</span>
        <span className={styles.trayType}>
          {each.type === null ? dispatch.unknown : (dispatch.typeNames[each.type] ?? each.type)}
        </span>
      </span>
      <span className={styles.trayLine}>{askedWord(each)}</span>
      <span className={isOtherThanAsked(each) ? styles.trayOffered : styles.trayLine}>
        {dispatch.tray.offered(offeredWord(each.date, each.offered_window))}
      </span>
      {referredBy !== null && <span className={styles.trayLine}>{dispatch.tray.referred(referredBy)}</span>}
      {each.was_technician !== null && (
        <span className={styles.trayWas}>{dispatch.tray.was(each.was_technician.name)}</span>
      )}
    </>
  );
}

type Take = (job: Job, from: HTMLElement) => void;

/** A job to take up and put on a technician, or, for a person who may not, only to read. */
function TrayJob({ each, onTake }: { each: Unassigned; onTake: Take | null }) {
  if (onTake === null) {
    return (
      <div className={`${styles.trayJob ?? ""} ${styles.trayJobStill ?? ""}`}>
        <TrayLines each={each} />
      </div>
    );
  }
  const job: Job = { kind: "unassigned", job: each };
  return (
    <button
      className={styles.trayJob}
      type="button"
      draggable
      data-appointment={each.appointment_id}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", each.appointment_id);
        onTake(job, event.currentTarget);
      }}
      onClick={(event) => {
        onTake(job, event.currentTarget);
      }}
    >
      <TrayLines each={each} />
    </button>
  );
}

interface Props {
  readonly unassigned: readonly Unassigned[];
  /** Null when the person's access does not let them put a job on a technician. */
  readonly onTake: Take | null;
}

export function Tray({ unassigned, onTake }: Props) {
  const empty = unassigned.length === 0;
  return (
    <aside
      className={empty ? `${styles.tray ?? ""} ${styles.trayRail ?? ""}` : styles.tray}
      aria-labelledby="unassigned"
    >
      <div className={styles.trayHead}>
        <h2 className={styles.trayTitle} id="unassigned">
          {dispatch.tray.title}
        </h2>
        <span className={styles.count}>{unassigned.length}</span>
      </div>
      {empty ? (
        <VisuallyHidden as="p">{dispatch.tray.empty}</VisuallyHidden>
      ) : (
        <ul className={styles.trayList}>
          {unassigned.map((each) => (
            <li key={each.appointment_id}>
              <TrayJob each={each} onTake={onTake} />
            </li>
          ))}
        </ul>
      )}
      {!empty && <p className={styles.note}>{dispatch.tray.same}</p>}
    </aside>
  );
}
