// A day down the hours, for the technician's Schedule (docs/prompts/tech-redesign.md, "Schedule"): a line at each hour
// with its time, each visit a block as long as it lasts, the drive before it hatched, and a line at the minute it is
// now. A row of the table for every five minutes, so a block is as tall as its length and nothing is placed by hand,
// as in DayTimeline. A block that would start inside the one before starts where that one ends, and one wholly inside
// it is listed in its cell, so no block goes undrawn. DayTimeline draws a day along the hours, a row for each person, on
// the console; this draws one person's day down the hours, on a phone.
//
//   <DayColumn label="Thursday's visits" from={8 * 60} to={20 * 60} hour={clockOf} blocks={blocks} now={null} />

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import { Link } from "./router.tsx";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import styles from "./day-column.module.css";

/** The minutes a row of the column stands for. */
export const DAY_STEP = 5;

export interface DayBlock {
  readonly key: string;
  /** Minutes after midnight it starts at, and how many it lasts. */
  readonly start: number;
  readonly minutes: number;
  /** A visit still to do, one done with, or the drive before one. */
  readonly look: "visit" | "done" | "drive";
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  /** Where the block opens; a drive opens nothing. */
  readonly to?: string | undefined;
}

interface Cell {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly block: DayBlock | null;
  /** The blocks wholly inside this one, listed in its cell beneath its own words. */
  readonly within: readonly DayBlock[];
  /** The block's own words are in the cell it starts in alone. */
  readonly first: boolean;
  readonly atNow: boolean;
}

const onStep = (minute: number) => Math.round(minute / DAY_STEP) * DAY_STEP;

/** The day in stretches, gap or block, each block clipped to the hours and to the end of the one before it. */
function stretchesOf(from: number, to: number, blocks: readonly DayBlock[]): Omit<Cell, "first" | "atNow">[] {
  const stretches: Omit<Cell, "first" | "atNow">[] = [];
  let at = from;
  for (const block of [...blocks].sort((one, other) => one.start - other.start)) {
    const start = Math.max(at, onStep(block.start));
    const end = Math.min(to, onStep(block.start + block.minutes));
    const before = stretches.at(-1);
    if (end <= start) {
      // Wholly inside the block before: listed in its cell. One outside the hours drawn is the caller's to widen.
      if (before !== undefined && before.block !== null && block.look !== "drive" && start < to) {
        stretches[stretches.length - 1] = { ...before, within: [...before.within, block] };
      }
      continue;
    }
    if (start > at) stretches.push({ key: `gap-${String(at)}`, from: at, to: start, block: null, within: [] });
    stretches.push({ key: block.key, from: start, to: end, block, within: [] });
    at = end;
  }
  if (at < to) stretches.push({ key: `gap-${String(at)}`, from: at, to, block: null, within: [] });
  return stretches;
}

/** Each stretch cut where a gap crosses an hour, so its line shows, and where it is now, so the now-line does. */
function cellsOf(from: number, to: number, blocks: readonly DayBlock[], now: number | null): Cell[] {
  const nowAt = now === null || now <= from || now >= to ? null : onStep(now);
  return stretchesOf(from, to, blocks).flatMap((stretch) => {
    const cuts = new Set<number>();
    if (stretch.block === null) {
      for (let hour = Math.ceil((stretch.from + 1) / 60) * 60; hour < stretch.to; hour += 60) cuts.add(hour);
    }
    if (nowAt !== null && nowAt > stretch.from && nowAt < stretch.to) cuts.add(nowAt);
    const edges = [stretch.from, ...[...cuts].sort((one, other) => one - other), stretch.to];
    return edges.slice(0, -1).map((edge, index) => ({
      ...stretch,
      key: index === 0 ? stretch.key : `${stretch.key}/${String(edge)}`,
      from: edge,
      to: edges[index + 1] ?? stretch.to,
      first: index === 0,
      atNow: edge === nowAt,
    }));
  });
}

const LOOKS: Readonly<Record<DayBlock["look"], string | undefined>> = {
  visit: styles.visit,
  done: styles.done,
  drive: styles.drive,
};

function Label({ block }: { readonly block: DayBlock }) {
  const words = (
    <>
      <span className={styles.title}>{block.title}</span>
      {block.meta !== undefined && <span className={styles.meta}>{block.meta}</span>}
    </>
  );
  return block.to === undefined ? (
    <span className={styles.label}>{words}</span>
  ) : (
    <Link className={styles.label} to={block.to}>
      {words}
    </Link>
  );
}

/** A block's words, and those of any block wholly inside it, from the top of its cell. */
function Words({ block, within }: { readonly block: DayBlock; readonly within: readonly DayBlock[] }) {
  return (
    <span className={styles.words}>
      <Label block={block} />
      {within.map((each) => (
        <Label key={each.key} block={each} />
      ))}
    </span>
  );
}

export function DayColumn({
  label,
  from,
  to,
  hour,
  blocks,
  now = null,
  nowLabel,
}: {
  /** What a screen reader hears the day as. */
  readonly label: string;
  /** The first and last hour shown, as minutes after midnight; each a whole hour. */
  readonly from: number;
  readonly to: number;
  /** An hour's words, by its minutes after midnight: "8 am". */
  readonly hour: (minute: number) => string;
  readonly blocks: readonly DayBlock[];
  /** The minute it is now, on today; null on another day. */
  readonly now?: number | null;
  /** What a screen reader hears at the now-line. */
  readonly nowLabel?: string | undefined;
}) {
  const cells = cellsOf(from, to, blocks, now);
  const rows = Array.from({ length: (to - from) / DAY_STEP }, (_, index) => from + index * DAY_STEP);
  return (
    <table className={styles.column} aria-label={label}>
      <tbody>
        {rows.map((minute) => {
          const cell = cells.find((each) => each.from === minute);
          return (
            <tr key={minute} className={styles.step}>
              {minute % 60 === 0 && (
                <th scope="row" className={styles.hour} rowSpan={60 / DAY_STEP}>
                  <span className={styles.hourWords}>{hour(minute)}</span>
                </th>
              )}
              {cell !== undefined && (
                <td
                  className={classes(
                    styles.cell,
                    minute % 60 === 0 && styles.onHour,
                    cell.block !== null && LOOKS[cell.block.look],
                    cell.block !== null && !cell.first && styles.continued,
                    cell.atNow && styles.now,
                  )}
                  rowSpan={(cell.to - cell.from) / DAY_STEP}
                >
                  {cell.block !== null && cell.first && <Words block={cell.block} within={cell.within} />}
                  {cell.atNow && nowLabel !== undefined && <VisuallyHidden>{nowLabel}</VisuallyHidden>}
                </td>
              )}
            </tr>
          );
        })}
        {/* The last hour's line and time, closing the day. */}
        <tr className={styles.end}>
          <th scope="row" className={styles.hour}>
            <span className={styles.hourWords}>{hour(to)}</span>
          </th>
          <td className={classes(styles.cell, styles.onHour)} />
        </tr>
      </tbody>
    </table>
  );
}
