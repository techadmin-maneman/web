// Board A1's unassigned tray: the jobs nobody holds yet, each with the client,
// the kind of visit, the window the client asked for beside the one offered,
// and who invited the client, where someone did (the brief's "referral
// source"). The asked window is what the client picked; a visit whose booking
// recorded none says so rather than repeating the offered one, and the asked
// window carries no day, since none was recorded with it (ADR 0063). An
// offered window that is not the one asked for is lettered in oxblood, as the
// board draws it.

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

interface Props {
  readonly unassigned: readonly Unassigned[];
  readonly onTake: (job: Job, from: HTMLElement) => void;
}

export function Tray({ unassigned, onTake }: Props) {
  return (
    <aside className={styles.tray} aria-labelledby="unassigned">
      <div className={styles.trayHead}>
        <h2 className={styles.trayTitle} id="unassigned">
          {dispatch.tray.title}
        </h2>
        <span className={styles.count}>{unassigned.length}</span>
      </div>
      {unassigned.length === 0 ? (
        <p className={styles.empty}>{dispatch.tray.empty}</p>
      ) : (
        <ul className={styles.trayList}>
          {unassigned.map((each) => {
            const job: Job = { kind: "unassigned", job: each };
            const referredBy = each.person === null ? null : each.person.referred_by;
            return (
              <li key={each.appointment_id}>
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
                  <span className={styles.trayTop}>
                    <span>{each.person?.name ?? nameOf(job)}</span>
                    <span className={styles.trayType}>
                      {each.type === null ? dispatch.unknown : (dispatch.typeNames[each.type] ?? each.type)}
                    </span>
                  </span>
                  <span className={styles.trayLine}>{askedWord(each)}</span>
                  <span className={isOtherThanAsked(each) ? styles.trayOffered : styles.trayLine}>
                    {dispatch.tray.offered(offeredWord(each.date, each.offered_window))}
                  </span>
                  {referredBy !== null && <span className={styles.trayLine}>{dispatch.tray.referred(referredBy)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.note}>{dispatch.tray.same}</p>
    </aside>
  );
}
