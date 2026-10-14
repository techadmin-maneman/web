// The board's grid: technicians down, seven days across, each day headed by its utilisation, the header and names
// staying put as it scrolls. With a job in hand each day offers the windows it would land in (ADR 0062), for the mouse;
// the keyboard chooses from the list above. A search outlines what it found. A row, a day and a block draw again only
// when what they show changes.

import { TextButton } from "@maneman/ui/TextLink";
import { Table } from "@maneman/ui/Table";
import { Tile } from "@maneman/ui/Tile";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { inIndia, shortDate } from "@maneman/web-kit/dates";
import { memo, useMemo } from "react";
import type { Block, Board, BoardRow, BookingWindow } from "../api.ts";
import { dispatch } from "../content.ts";
import label from "../components/label.module.css";
import styles from "./dispatch.module.css";
import { begunWord, isMovable, nameOf, type Job, type Target, windowWord } from "./job.ts";

/** A job in hand, and the windows each technician's day would take it in; null while the board is asking. */
export interface InHand {
  readonly job: Job;
  readonly windowsAt: (technicianId: string, date: string) => readonly BookingWindow[] | null;
  /** As the crow flies, from the job to the technician's nearest other visit that day; null where unknown. */
  readonly kmAt: (technicianId: string, date: string) => number | null;
}

/** "Fri 19", as a column is headed. */
const dayHead = (date: string) => shortDate(date).split(" ").slice(0, 2).join(" ");

/** A block's second line: "Sec 65 · service". */
const whatOf = (block: Block) =>
  [block.sector, block.type === null ? null : dispatch.types[block.type]]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");

/** "10:30", "16:00": when a block starts, on India's 24-hour clock, short enough to sit beside the client's name. */
function startOf(block: Block): string {
  const india = inIndia(block.starts_at);
  return `${String(india.getUTCHours())}:${String(india.getUTCMinutes()).padStart(2, "0")}`;
}

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

/** Leave covers whole days, both ends included, and the route clips it to this week. */
const isAway = (leave: Board["leave"], technicianId: string, date: string) =>
  leave.some((period) => period.technician_id === technicianId && period.from <= date && date <= period.to);

/** A technician's day, as the board's days are looked up. */
const dayKey = (technicianId: string, date: string) => `${technicianId} ${date}`;

const NO_BLOCKS: readonly Block[] = [];

/** Each technician's blocks by day, and the days they are away, read once from each answer of the board. */
interface Days {
  readonly blocks: ReadonlyMap<string, readonly Block[]>;
  readonly away: ReadonlySet<string>;
}

function daysOf(board: Board): Days {
  const blocks = new Map<string, readonly Block[]>();
  const away = new Set<string>();
  for (const row of board.technicians) {
    for (const day of row.days) blocks.set(dayKey(row.technician_id, day.date), day.blocks);
    for (const date of board.dates) {
      if (isAway(board.leave, row.technician_id, date)) away.add(dayKey(row.technician_id, date));
    }
  }
  return { blocks, away };
}

/** Takes a job up to move it; null when the person's access does not let them move one. */
type Take = ((job: Job, from: HTMLElement) => void) | null;

/** Whether a block is one the search found; null when the search names no block. */
type Found = ((block: Block) => boolean) | null;

interface BlockButtonProps {
  readonly block: Block;
  readonly technician: BoardRow;
  readonly date: string;
  /** The search found it, so it is outlined and says so. */
  readonly matched: boolean;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: Take;
}

/** The block as a screen reader names it: the visit, its day and window, and done or how far it has got. */
function blockLabel(job: Job & { readonly kind: "block" }): string {
  const { block } = job;
  const where = [nameOf(job), shortDate(job.date), windowWord(block.window)] as const;
  if (block.status === "completed") return dispatch.board.doneBlock(...where);
  const begun = begunWord(block);
  return begun === null ? dispatch.board.block(...where) : dispatch.board.begunBlock(...where, begun);
}

/**
 * One visit on a technician's day. A visit done, or one the technician has begun, opens its drawer and cannot be
 * dragged.
 */
const BlockButton = memo(function BlockButton({ block, technician, date, matched, onOpen, onTake }: BlockButtonProps) {
  const job = { kind: "block", block, technician, date } as const;
  const movable = isMovable(block);
  const begun = begunWord(block);
  return (
    <Tile
      className={classes(styles.block, inkOf(block), sizeOf(block), !movable && styles.finished)}
      data-appointment={block.appointment_id}
      data-match={matched ? "" : undefined}
      draggable={movable && onTake !== null}
      aria-label={matched ? dispatch.board.found(blockLabel(job)) : blockLabel(job)}
      onDragStart={(event) => {
        if (onTake === null) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", block.appointment_id);
        onTake(job, event.currentTarget);
      }}
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
    </Tile>
  );
});

interface CellProps {
  readonly technician: BoardRow;
  readonly date: string;
  readonly blocks: readonly Block[];
  /** Ops recorded leave for this technician on this day, so it takes no job. */
  readonly away: boolean;
  readonly inHand: InHand | null;
  readonly found: Found;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: Take;
  readonly onLand: (to: Target) => void;
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

/**
 * One technician's day: the blocks on it, and, while a job is in hand, the
 * windows it would land in. A day marked away still draws whatever it holds —
 * leave recorded after a job was assigned must not hide that job — and offers
 * no window to put another one in.
 */
const Cell = memo(function Cell({ technician, date, blocks, away, inHand, found, onOpen, onTake, onLand }: CellProps) {
  const windows = inHand === null || away ? null : inHand.windowsAt(technician.technician_id, date);
  return (
    <td className={away ? `${styles.cell ?? ""} ${styles.away ?? ""}` : styles.cell}>
      {away && <AwayMark technician={technician} date={date} blocks={blocks} />}
      {blocks.map((block) => (
        <BlockButton
          key={block.appointment_id}
          block={block}
          technician={technician}
          date={date}
          matched={found?.(block) === true}
          onOpen={onOpen}
          onTake={onTake}
        />
      ))}
      {inHand !== null && windows !== null && windows.length === 0 && (
        <span className={styles.noRoom}>{dispatch.landing.noRoom}</span>
      )}
      {inHand !== null && windows !== null && windows.length > 0 && (
        <div className={styles.targets}>
          {windows.map((window) => (
            <Tile
              className={styles.target}
              key={window}
              tabIndex={-1}
              aria-label={dispatch.landing.choose(
                nameOf(inHand.job),
                technician.name,
                shortDate(date),
                windowWord(window),
              )}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                onLand({ technician, date, window });
              }}
              onClick={() => {
                onLand({ technician, date, window });
              }}
            >
              {windowWord(window)}
            </Tile>
          ))}
        </div>
      )}
    </td>
  );
});

interface RowProps extends Omit<CellProps, "date" | "blocks" | "away"> {
  readonly dates: readonly string[];
  readonly days: Days;
}

const TechnicianRow = memo(function TechnicianRow({ technician, dates, days, ...cell }: RowProps) {
  return (
    <tr>
      <th className={styles.tech} scope="row">
        <span>{technician.name}</span>
        <span className={styles.zone}>{technician.zone ?? dispatch.unknown}</span>
      </th>
      {dates.map((date) => (
        <Cell
          {...cell}
          away={days.away.has(dayKey(technician.technician_id, date))}
          blocks={days.blocks.get(dayKey(technician.technician_id, date)) ?? NO_BLOCKS}
          date={date}
          key={date}
          technician={technician}
        />
      ))}
    </tr>
  );
});

interface GridProps {
  readonly board: Board;
  /** The technicians to draw: the board's, narrowed by what ops searched for. */
  readonly rows: readonly BoardRow[];
  readonly inHand: InHand | null;
  readonly found: Found;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: Take;
  readonly onLand: (to: Target) => void;
  /** Opens a day's routes; null where the person's access does not reach them. */
  readonly onRoutes: ((date: string) => void) | null;
}

export const Grid = memo(function Grid({ board, rows, inHand, found, onOpen, onTake, onLand, onRoutes }: GridProps) {
  const days = useMemo(() => daysOf(board), [board]);
  return (
    <Table plain className={styles.grid}>
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
        {rows.map((technician) => (
          <TechnicianRow
            key={technician.technician_id}
            technician={technician}
            dates={board.dates}
            days={days}
            found={found}
            inHand={inHand}
            onLand={onLand}
            onOpen={onOpen}
            onTake={onTake}
          />
        ))}
      </tbody>
    </Table>
  );
});
