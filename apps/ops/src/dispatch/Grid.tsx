// The board's grid: technicians down, seven days across, each day headed by its utilisation, the header and names
// staying put as it scrolls. A visit is moved from its drawer, to a day and start chosen from the list above the board
// (./MoveBar.tsx), not dragged. A search outlines what it found. A row, a day and a block draw again only when what they
// show changes.

import { TextButton } from "@maneman/ui/TextLink";
import { Table } from "@maneman/ui/Table";
import { Tile } from "@maneman/ui/Tile";
import { Badge } from "@maneman/ui/Badge";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useNearView } from "@maneman/ui/useNearView";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { timeRange, UNBROKEN } from "@rules/lib/time-range.ts";
import { memo, useMemo } from "react";
import type { Block, Board, BoardRow } from "../api.ts";
import { dispatch } from "../content.ts";
import label from "../components/label.module.css";
import styles from "./grid.module.css";
import { begunWord, isMovable, nameOf, type Job } from "./job.ts";

/** "Fri 19", as a column is headed. */
const dayHead = (date: string) => shortDate(date).split(" ").slice(0, 2).join(" ");

/** A block's second line: "Sec 65 · service". */
const whatOf = (block: Block) =>
  [block.sector, block.type === null ? null : dispatch.types[block.type]]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");

/** "10:30 am", "4 pm": when a block starts, as every surface writes a time. */
const startOf = (block: Block): string => indiaClock(block.starts_at);

/** The board's three inks: a first fit on ink, a replacement shaded, everything else on light paper. */
function inkOf(block: Block): string | undefined {
  if (block.type === "first_fit") return styles.fit;
  if (block.type === "replacement") return styles.repl;
  return styles.svc;
}

/** "Blocks are sized by slot: consultation and service 1, replacement 1.5, first fit 2." */
function sizeOf(block: Block): string | undefined {
  if (block.slots >= 2) return styles.slots2;
  if (block.slots > 1) return styles.slots15;
  return styles.slots1;
}

/** The technician's leave on a day: whole days, both ends included, clipped to this week; or part of one day. */
const leaveOn = (leave: Board["leave"], technicianId: string, date: string) =>
  leave.find((period) => period.technician_id === technicianId && period.from <= date && date <= period.to);

/** A technician's day, as the board's days are looked up. */
const dayKey = (technicianId: string, date: string) => `${technicianId} ${date}`;

const NO_BLOCKS: readonly Block[] = [];

/** Each technician's blocks by day, and the days they are away, read once from each answer of the board. */
interface Days {
  readonly blocks: ReadonlyMap<string, readonly Block[]>;
  readonly away: ReadonlySet<string>;
  /** The hours of leave over part of a day, "2–5 pm". */
  readonly awayHours: ReadonlyMap<string, string>;
}

function daysOf(board: Board): Days {
  const blocks = new Map<string, readonly Block[]>();
  const away = new Set<string>();
  const awayHours = new Map<string, string>();
  for (const row of board.technicians) {
    for (const day of row.days) blocks.set(dayKey(row.technician_id, day.date), day.blocks);
    for (const date of board.dates) {
      const leave = leaveOn(board.leave, row.technician_id, date);
      const key = dayKey(row.technician_id, date);
      if (leave === undefined) continue;
      if (leave.from_time === null || leave.to_time === null) away.add(key);
      else awayHours.set(key, timeRange(leave.from_time, leave.to_time, UNBROKEN));
    }
  }
  return { blocks, away, awayHours };
}

/** Whether a block is one the search found; null when the search names no block. */
type Found = ((block: Block) => boolean) | null;

interface BlockButtonProps {
  readonly block: Block;
  readonly technician: BoardRow;
  readonly date: string;
  /** The search found it, so it is outlined and says so. */
  readonly matched: boolean;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
}

/** A block's state where it is no longer simply booked: done, not done, or a move the client is asked about. */
function StateChip({ block }: { block: Block }) {
  const chips = dispatch.chips;
  if (block.status === "completed") return <Badge tone="done">{chips.completed}</Badge>;
  if (block.status === "terminated") return <Badge tone="warning">{chips.terminated}</Badge>;
  if (block.proposal !== null) return <Badge tone="attention">{chips.proposal}</Badge>;
  return null;
}

/** The block as a screen reader names it: the visit, its day and start, and done or how far it has got. */
function blockLabel(job: Job & { readonly kind: "block" }): string {
  const { block } = job;
  const where = [nameOf(job), shortDate(job.date), indiaClock(block.starts_at)] as const;
  if (block.status === "completed") return dispatch.board.doneBlock(...where);
  const begun = begunWord(block);
  return begun === null ? dispatch.board.block(...where) : dispatch.board.begunBlock(...where, begun);
}

/** One visit on a technician's day, which opens its drawer. A visit done, or one the technician has begun, is drawn as such. */
const BlockButton = memo(function BlockButton({ block, technician, date, matched, onOpen }: BlockButtonProps) {
  const job = { kind: "block", block, technician, date } as const;
  const movable = isMovable(block);
  const begun = begunWord(block);
  return (
    <Tile
      className={classes(styles.block, inkOf(block), sizeOf(block), !movable && styles.finished)}
      data-appointment={block.appointment_id}
      data-match={matched ? "" : undefined}
      aria-label={matched ? dispatch.board.found(blockLabel(job)) : blockLabel(job)}
      onClick={(event) => {
        onOpen(job, event.currentTarget);
      }}
    >
      <span className={styles.who}>
        <span className={styles.name}>{block.client ?? dispatch.unknown}</span>
        <span className={styles.at}>{startOf(block)}</span>
      </span>
      <span className={styles.what}>{whatOf(block)}</span>
      {begun !== null && <span className={styles.what}>{begun}</span>}
      <StateChip block={block} />
    </Tile>
  );
});

interface CellProps {
  readonly technician: BoardRow;
  readonly date: string;
  readonly blocks: readonly Block[];
  /** Ops recorded leave for this technician on this day, so it takes no job. */
  readonly away: boolean;
  /** Leave over part of the day, "2–5 pm": the day still takes jobs outside it. */
  readonly awayHours: string | null;
  readonly found: Found;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
}

/** The day's leave, and the jobs still booked on it, which the leave moved nowhere. */
function AwayMark({ technician, date, blocks }: { technician: BoardRow; date: string; blocks: readonly Block[] }) {
  const copy = dispatch.board;
  const stranded = blocks.filter((block) => block.status === "scheduled" || block.status === "dispatched").length;
  const day = shortDate(date);
  const marked = stranded === 0 ? styles.awayMark : `${styles.awayMark ?? ""} ${styles.stranded ?? ""}`;
  return (
    <span className={classes(marked, capsLook(label.caps))}>
      <span aria-hidden="true">{stranded === 0 ? copy.away : copy.stranded(stranded)}</span>
      <VisuallyHidden>
        {stranded === 0 ? copy.awayLabel(technician.name, day) : copy.strandedLabel(technician.name, day, stranded)}
      </VisuallyHidden>
    </span>
  );
}

/** Leave over part of the day, which the room the board offers already keeps clear of. */
function AwayHoursMark({ technician, date, hours }: { technician: BoardRow; date: string; hours: string }) {
  const copy = dispatch.board;
  return (
    <span className={classes(styles.awayMark, capsLook(label.caps))}>
      <span aria-hidden="true">{copy.awayFor(hours)}</span>
      <VisuallyHidden>{copy.awayForLabel(technician.name, shortDate(date), hours)}</VisuallyHidden>
    </span>
  );
}

/**
 * One technician's day: the blocks on it. A day marked away still draws whatever it holds — leave recorded after a job
 * was assigned must not hide that job.
 */
const Cell = memo(function Cell({ technician, date, blocks, away, awayHours, found, onOpen }: CellProps) {
  return (
    <td className={away ? `${styles.cell ?? ""} ${styles.away ?? ""}` : styles.cell}>
      {away && <AwayMark technician={technician} date={date} blocks={blocks} />}
      {awayHours !== null && <AwayHoursMark technician={technician} date={date} hours={awayHours} />}
      {blocks.map((block) => (
        <BlockButton
          key={block.appointment_id}
          block={block}
          technician={technician}
          date={date}
          matched={found?.(block) === true}
          onOpen={onOpen}
        />
      ))}
    </td>
  );
});

interface RowProps extends Omit<CellProps, "date" | "blocks" | "away" | "awayHours"> {
  readonly dates: readonly string[];
  readonly days: Days;
}

const TechnicianRow = memo(function TechnicianRow({ technician, dates, days, ...cell }: RowProps) {
  return (
    <tr>
      <th className={styles.tech} scope="row">
        <span>{technician.name}</span>
        {technician.zone !== null && <span className={styles.zone}>{technician.zone}</span>}
      </th>
      {dates.map((date) => (
        <Cell
          {...cell}
          away={days.away.has(dayKey(technician.technician_id, date))}
          awayHours={days.awayHours.get(dayKey(technician.technician_id, date)) ?? null}
          blocks={days.blocks.get(dayKey(technician.technician_id, date)) ?? NO_BLOCKS}
          date={date}
          key={date}
          technician={technician}
        />
      ))}
    </tr>
  );
});

/** Rows drawn at once; past them, each is drawn as it scrolls near, so a board of many technicians opens quickly. */
const ROWS_AT_ONCE = 60;

/** A row past the first ROWS_AT_ONCE: its technician's name, at a row's height, until it scrolls near. */
const LaterRow = memo(function LaterRow(props: RowProps) {
  const [row, near] = useNearView<HTMLTableRowElement>();
  if (near) return <TechnicianRow {...props} />;
  return (
    <tr ref={row}>
      <th className={styles.tech} scope="row">
        <span>{props.technician.name}</span>
      </th>
      <td className={styles.cell} colSpan={props.dates.length} />
    </tr>
  );
});

interface GridProps {
  readonly board: Board;
  /** The technicians to draw: the board's, narrowed by what ops searched for. */
  readonly rows: readonly BoardRow[];
  readonly found: Found;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  /** Opens a day's routes; null where the person's access does not reach them. */
  readonly onRoutes: ((date: string) => void) | null;
}

/** Beneath the board: what each block's edge and each state on a block says. */
function Legend() {
  const words = dispatch.legend;
  return (
    <caption className={styles.legend}>
      <span className={classes(styles.key, styles.svc)}>{words.service}</span>
      <span className={classes(styles.key, styles.repl)}>{words.replacement}</span>
      <span className={classes(styles.key, styles.fit)}>{words.fit}</span>
      <Badge tone="done">{dispatch.chips.completed}</Badge>
      <Badge tone="warning">{dispatch.chips.terminated}</Badge>
      <Badge tone="attention">{dispatch.chips.proposal}</Badge>
    </caption>
  );
}

export const Grid = memo(function Grid({ board, rows, found, onOpen, onRoutes }: GridProps) {
  const days = useMemo(() => daysOf(board), [board]);
  return (
    <Table plain className={styles.grid}>
      <Legend />
      <thead>
        <tr>
          <td className={styles.corner} />
          {board.dates.map((date) => {
            const percent = board.utilisation.find((day) => day.date === date)?.percent ?? 0;
            return (
              <th className={styles.day} key={date} scope="col">
                <span className={styles.dayName}>{dayHead(date)}</span>
                <span className={percent >= dispatch.peak ? styles.peak : styles.util}>
                  {dispatch.util(percent)}
                  {percent >= dispatch.peak && <VisuallyHidden>, {dispatch.peakDay}</VisuallyHidden>}
                </span>
                {onRoutes !== null && (
                  <TextButton
                    tone="muted"
                    compact
                    className={styles.dayMap}
                    aria-label={dispatch.routes.openLabel(dayHead(date))}
                    onClick={() => {
                      onRoutes(date);
                    }}
                  >
                    {dispatch.routes.open}
                  </TextButton>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((technician, index) => {
          const Row = index < ROWS_AT_ONCE ? TechnicianRow : LaterRow;
          return (
            <Row
              key={technician.technician_id}
              technician={technician}
              dates={board.dates}
              days={days}
              found={found}
              onOpen={onOpen}
            />
          );
        })}
      </tbody>
    </Table>
  );
});
