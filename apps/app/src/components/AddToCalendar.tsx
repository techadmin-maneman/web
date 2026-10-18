// A visit to come, offered to the client's own calendar: Google's, or an .ics file for Apple's, Outlook's and the rest.
// It holds the visit from its start to its end, and when the technician arrives, as the visit's card writes it, and the
// visit's id, so adding it again after a move updates the entry rather than adding a second.

import { ButtonLink } from "@maneman/ui/Button";
import { capsLook } from "@maneman/ui/Caps";
import { googleCalendarLink, icsHref, type CalendarEntry } from "@rules/lib/calendar.ts";
import { arrivalHours, calendar } from "../content.ts";
import styles from "./add-to-calendar.module.css";

interface CalendarVisit {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  /** The latest the technician arrives. */
  readonly arrives_by: string;
  /** "First fit", as the visit's card names it. */
  readonly name: string;
  readonly technician: string | null;
}

export function AddToCalendar({ visit, onInk = false }: { visit: CalendarVisit; onInk?: boolean }) {
  const entry: CalendarEntry = {
    title: calendar.title(visit.name),
    start: new Date(visit.starts_at),
    end: new Date(visit.ends_at),
    // A calendar wraps as it likes, so its hours keep plain spaces.
    details: calendar.details(arrivalHours(visit, " "), visit.technician),
    uid: `${visit.id}@maneman.in`,
  };
  const variant = onInk ? "outlineOnInk" : "outline";
  return (
    <div className={styles.calendar}>
      <p className={capsLook(onInk ? styles.labelOnInk : styles.label)}>{calendar.label}</p>
      <div className={styles.links}>
        <ButtonLink
          variant={variant}
          size="control"
          className={styles.link}
          href={googleCalendarLink(entry)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {calendar.google}
        </ButtonLink>
        <ButtonLink
          variant={variant}
          size="control"
          className={styles.link}
          href={icsHref(entry, new Date())}
          download={calendar.fileName}
        >
          {calendar.file}
        </ButtonLink>
      </div>
    </div>
  );
}
