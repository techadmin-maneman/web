// The day a visit is being booked on, along the hours (packages/ui/DayTimeline.tsx): each technician who can take one
// of its starts, the visits already on their day, and each start they can take a button that picks it and them. The
// visits come from the board, for whoever may read it; without it, the starts alone.

import { DayTimeline, type TimelineCell } from "@maneman/ui/DayTimeline";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { dayClock, indiaClock, shortDate } from "@maneman/web-kit/dates";
import { MINUTES_PER_UNIT } from "@rules/policy/visit-length.ts";
import { useCallback } from "react";
import type { Board, VisitAvailability } from "../api.ts";
import { useAccess } from "../lib/access.ts";
import { cellsOf, minuteOfDay, stepsOf } from "../lib/day-cells.ts";
import type { Picked } from "./book-slot.ts";
import { copy } from "./book-slot.ts";
import { clientsApi } from "./clients-api.ts";

type Day = VisitAvailability["days"][number];

interface Taker {
  readonly id: string;
  readonly name: string;
}

/** Each technician the day's starts name, in the order they first come. */
function takersOf(day: Day): Taker[] {
  const seen = new Map<string, Taker>();
  for (const start of day.starts) for (const each of start.technicians) if (!seen.has(each.id)) seen.set(each.id, each);
  return [...seen.values()];
}

/** The visits already on a technician's day, from the board, by the minutes they hold. */
function visitsOf(board: Board | null, technician: string, date: string) {
  const row = board?.technicians.find((each) => each.technician_id === technician);
  const blocks = row?.days.find((each) => each.date === date)?.blocks ?? [];
  return blocks.map((block) => {
    const from = minuteOfDay(block.starts_at);
    return { from, to: from + block.slots * 2 * MINUTES_PER_UNIT, client: block.client };
  });
}

const hourLabel = (minute: number) => (minute % 60 === 0 ? dayClock(`${String(minute / 60).padStart(2, "0")}:00`) : "");

function Timeline({
  day,
  board,
  picked,
  onPick,
}: {
  day: Day;
  board: Board | null;
  picked: { start: string | undefined; technician: string };
  onPick: (next: Partial<Picked>) => void;
}) {
  const takers = takersOf(day);
  const freeOf = (technician: string) =>
    day.starts
      .filter((start) => start.technicians.some((each) => each.id === technician))
      .map((start) => ({ at: minuteOfDay(start.starts_at), starts_at: start.starts_at }));
  const steps = stepsOf(
    [
      ...takers.flatMap((taker) => visitsOf(board, taker.id, day.date)),
      ...day.starts.map((start) => ({ from: minuteOfDay(start.starts_at), to: minuteOfDay(start.starts_at) })),
    ],
    true,
  );
  const rows = takers.map((taker) => ({
    key: taker.id,
    head: taker.name,
    cells: cellsOf(steps, visitsOf(board, taker.id, day.date), freeOf(taker.id)).map((cell): TimelineCell => {
      const key = `${taker.id}/${String(cell.from)}`;
      if (cell.kind === "idle") return { key, span: cell.span, look: "idle" };
      if (cell.kind === "busy") return { key, span: cell.span, look: "busy", children: cell.busy.client };
      const time = indiaClock(cell.free.starts_at);
      const chosen = picked.start === cell.free.starts_at && picked.technician === taker.id;
      return {
        key,
        span: 1,
        look: chosen ? "chosen" : "free",
        children: (
          <TextButton
            compact
            aria-pressed={chosen}
            onClick={() => {
              onPick({ start: cell.free.starts_at, technician: taker.id });
            }}
          >
            {time}
            <VisuallyHidden>{copy.pickWith(taker.name)}</VisuallyHidden>
          </TextButton>
        ),
      };
    }),
  }));
  const label = copy.dayLabel(shortDate(day.date));
  return (
    <>
      <VisuallyHidden as="p" id="book-day">
        {label}
      </VisuallyHidden>
      <DayTimeline
        label={label}
        labelledBy="book-day"
        steps={steps.map((minute) => ({ key: String(minute), label: hourLabel(minute) }))}
        rows={rows}
      />
    </>
  );
}

function WithBoard(props: Parameters<typeof Timeline>[0]) {
  const read = useCallback(() => clientsApi.board(props.day.date), [props.day.date]);
  const [loaded] = useLoad(read);
  return <Timeline {...props} board={loaded.state === "loaded" ? loaded.value : null} />;
}

export function BookDay(props: Omit<Parameters<typeof Timeline>[0], "board">) {
  const mayReadBoard = useAccess().mayCall("GET /api/dispatch");
  if (props.day.starts.length === 0) return null;
  return mayReadBoard ? <WithBoard {...props} board={null} /> : <Timeline {...props} board={null} />;
}
