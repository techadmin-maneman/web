// The board's head, at its right (./DispatchScreen.tsx): a step back and on, by the day or the week the view shows,
// with the day or the week between, which brings today back; and Day or Week.

import { GLYPHS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { IconButton } from "@maneman/ui/IconButton";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { addDays, shortDate } from "@maneman/web-kit/dates";
import { dispatch, noShows } from "../content.ts";
import { weekOf } from "./board-view.ts";
import type { BoardView } from "./DayBoard.tsx";
import styles from "./dispatch.module.css";

interface Props {
  readonly view: BoardView;
  readonly onView: (view: BoardView) => void;
  /** The day the Day view shows. */
  readonly day: string | undefined;
  readonly dates: readonly string[];
  readonly today: string;
  readonly onDay: (day: string) => void;
  /** Reads another week, from its first day; this week for null. */
  readonly onWeek: (from: string | null) => void;
}

export function BoardControls({ view, onView, day, dates, today, onDay, onWeek }: Props) {
  const copy = dispatch.tools;
  const from = dates[0];
  /** A day on, or back, reading the week it falls in where the board does not hold it. */
  const stepDay = (by: 1 | -1) => {
    if (day === undefined || from === undefined) return;
    const next = addDays(day, by);
    if (!dates.includes(next)) onWeek(addDays(from, 7 * by));
    onDay(next);
  };
  const step = (by: 1 | -1) => {
    if (view === "day") stepDay(by);
    else if (from !== undefined) onWeek(addDays(from, 7 * by));
  };
  const shown =
    view === "day" && day !== undefined ? noShows.money.title(shortDate(day), day === today) : weekOf(dates);
  return (
    <div className={styles.controls}>
      <div className={styles.stepper}>
        <IconButton
          className={styles.back}
          d={GLYPHS.chevron}
          size="md"
          label={view === "day" ? copy.previousDay : copy.previous}
          onClick={() => {
            step(-1);
          }}
        />
        <Button
          variant="quiet"
          size="control"
          onClick={() => {
            onWeek(null);
            onDay(today);
          }}
        >
          {shown}
        </Button>
        <IconButton
          d={GLYPHS.chevron}
          size="md"
          label={view === "day" ? copy.nextDay : copy.next}
          onClick={() => {
            step(1);
          }}
        />
      </div>
      <div className={styles.views} role="radiogroup" aria-label={dispatch.views.label}>
        {(["day", "week"] as const).map((each) => (
          <ToggleButton
            key={each}
            asRadio
            filled
            pressed={view === each}
            onClick={() => {
              onView(each);
            }}
          >
            {dispatch.views[each]}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
