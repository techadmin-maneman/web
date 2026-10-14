// A visit to come, offered to the client's own calendar: Google's, or an .ics file for Apple's, Outlook's and the rest.
// It holds the window the client was given, as the visit's card writes it, and the visit's id, so adding it again
// after a move updates the entry rather than adding a second.

import { ButtonLink } from "@maneman/ui/Button";
import { capsLook } from "@maneman/ui/Caps";
import { windowSpan } from "@rules/config/scheduling.ts";
import { googleCalendarLink, icsHref, type CalendarEntry } from "@rules/lib/calendar.ts";
import { timeRange } from "@rules/lib/time-range.ts";
import { calendar } from "../content.ts";
import styles from "./add-to-calendar.module.css";

interface CalendarVisit {
  readonly id: string;
  readonly date: string;
  /** The window's hours on its day, as the API gives them. */
  readonly hours: { readonly start: string; readonly end: string };
  /** "First fit", as the visit's card names it. */
  readonly name: string;
  readonly technician: string | null;
}

export function AddToCalendar({ visit, onInk = false }: { visit: CalendarVisit; onInk?: boolean }) {
  const entry: CalendarEntry = {
    title: calendar.title(visit.name),
    ...windowSpan(visit.date, visit.hours),
    // A calendar wraps as it likes, so its hours keep plain spaces.
    details: calendar.details(timeRange(visit.hours.start, visit.hours.end), visit.technician),
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
