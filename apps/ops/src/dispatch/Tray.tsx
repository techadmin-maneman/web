// The board's unassigned tray: the jobs nobody holds, each with the client, the kind of visit, the window asked for
// beside the one offered, in oxblood where they differ (ADR 0063), and who invited the client. A job on a technician
// switched off waits here too, saying whose it was. An empty tray folds to a rail, so the week gets the width.

import { Tile } from "@maneman/ui/Tile";
import { capsLook } from "@maneman/ui/Caps";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { shortDate } from "@maneman/web-kit/dates";
import type { BookingWindow, Unassigned } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./tray.module.css";
import { nameOf, type Job, windowWord } from "./job.ts";

const windowOrUnknown = (window: BookingWindow | null) => (window === null ? dispatch.unknown : windowWord(window));

/** "Sat, evening", as the tray writes the day and window offered. */
export const offeredWord = (date: string | null, window: BookingWindow | null) =>
  date === null ? windowOrUnknown(window) : `${shortDate(date).slice(0, 3)}, ${windowOrUnknown(window)}`;

/** The asked window, or the tray's words for a booking that recorded none. */
export const askedWord = (each: Unassigned) =>
  each.asked_window === null ? dispatch.tray.notAsked : dispatch.tray.asked(windowWord(each.asked_window));

/** The client asked for one window and is being offered another. */
const isOtherThanAsked = (each: Unassigned) => each.asked_window !== null && each.asked_window !== each.offered_window;

function TrayLines({ each }: { each: Unassigned }) {
  const referredBy = each.person === null ? null : each.person.referred_by;
  return (
    <>
      <span className={styles.trayTop}>
        <span>{each.person?.name ?? nameOf({ kind: "unassigned", job: each })}</span>
        <span className={capsLook(styles.trayType)}>
          {each.type === null ? dispatch.unknown : dispatch.typeNames[each.type]}
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

/** A job to open: its drawer assigns it, for a person who may put it on a technician. */
function TrayJob({ each, onOpen }: { each: Unassigned; onOpen: Take }) {
  const job: Job = { kind: "unassigned", job: each };
  return (
    <Tile
      className={styles.trayJob}
      data-appointment={each.appointment_id}
      onClick={(event) => {
        onOpen(job, event.currentTarget);
      }}
    >
      <TrayLines each={each} />
    </Tile>
  );
}

interface Props {
  readonly unassigned: readonly Unassigned[];
  readonly onOpen: Take;
}

export function Tray({ unassigned, onOpen }: Props) {
  const empty = unassigned.length === 0;
  return (
    <aside
      className={empty ? `${styles.tray ?? ""} ${styles.trayRail ?? ""}` : styles.tray}
      aria-labelledby="unassigned"
    >
      <div className={styles.trayHead}>
        <h2 className={capsLook(styles.trayTitle)} id="unassigned">
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
              <TrayJob each={each} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
