// Board A1's grid: technicians down, seven days across, each column headed by
// its utilisation. The header row and the technicians' column stay put while
// the grid scrolls under them (OPS-10), so a board of many technicians can be
// read at any depth.
//
// While a job is in hand, each day offers only the windows the job would land
// in, as the server answered for it: a day with none says so, and a day ops
// recorded leave on offers nothing (ADR 0062). The windows are for the mouse;
// the keyboard chooses from the list above the board, so the grid's thousands
// of windows are not each a stop in the tab order (FEO-14).

import { shortDate } from "@maneman/web-kit/dates";
import type { Block, Board, BoardRow, BookingWindow } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { isMovable, nameOf, type Job, type Target } from "./job.ts";

/** A job in hand, and the windows each technician's day would take it in; null while the board is asking. */
export interface InHand {
  readonly job: Job;
  readonly windowsAt: (technicianId: string, date: string) => readonly BookingWindow[] | null;
}

const windowWord = (window: BookingWindow) => dispatch.windows[window] ?? window;

/** "Fri 19", as a column is headed. */
const dayHead = (date: string) => shortDate(date).split(" ").slice(0, 2).join(" ");

/** A block's second line: "Sec 65 · service". */
const whatOf = (block: Block) =>
  [block.sector, block.type === null ? null : dispatch.types[block.type]]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");

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
export const isAway = (leave: Board["leave"], technicianId: string, date: string) =>
  leave.some((period) => period.technician_id === technicianId && period.from <= date && date <= period.to);

interface BlockButtonProps {
  readonly job: Job & { readonly kind: "block" };
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: (job: Job, from: HTMLElement) => void;
}

/** One visit on a technician's day. A visit already done opens its drawer and cannot be dragged. */
function BlockButton({ job, onOpen, onTake }: BlockButtonProps) {
  const { block } = job;
  const movable = isMovable(block);
  const label = movable ? dispatch.board.block : dispatch.board.doneBlock;
  return (
    <button
      className={`${styles.block ?? ""} ${inkOf(block) ?? ""} ${sizeOf(block) ?? ""} ${movable ? "" : (styles.finished ?? "")}`}
      type="button"
      data-appointment={block.appointment_id}
      draggable={movable}
      aria-label={label(nameOf(job), shortDate(job.date), windowWord(block.window))}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", block.appointment_id);
        onTake(job, event.currentTarget);
      }}
      onClick={(event) => {
        onOpen(job, event.currentTarget);
      }}
    >
      <span className={styles.who}>{block.client ?? dispatch.unknown}</span>
      <span className={styles.what}>{whatOf(block)}</span>
    </button>
  );
}

interface CellProps {
  readonly technician: BoardRow;
  readonly date: string;
  readonly blocks: readonly Block[];
  /** Ops recorded leave for this technician on this day, so it takes no job. */
  readonly away: boolean;
  readonly inHand: InHand | null;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: (job: Job, from: HTMLElement) => void;
  readonly onLand: (to: Target) => void;
}

/**
 * One technician's day: the blocks on it, and, while a job is in hand, the
 * windows it would land in. A day marked away still draws whatever it holds —
 * leave recorded after a job was assigned must not hide that job — and offers
 * no window to put another one in.
 */
/** The day's leave, and the jobs still booked on it, which the leave moved nowhere (OPS-07). */
function AwayMark({ technician, date, blocks }: { technician: BoardRow; date: string; blocks: readonly Block[] }) {
  const copy = dispatch.board;
  const stranded = blocks.filter((block) => block.status === "scheduled" || block.status === "dispatched").length;
  if (stranded === 0) {
    return (
      <span className={styles.awayMark} aria-label={copy.awayLabel(technician.name, shortDate(date))}>
        {copy.away}
      </span>
    );
  }
  return (
    <span className={styles.stranded} aria-label={copy.strandedLabel(technician.name, shortDate(date), stranded)}>
      {copy.stranded(stranded)}
    </span>
  );
}

function Cell({ technician, date, blocks, away, inHand, onOpen, onTake, onLand }: CellProps) {
  const windows = inHand === null || away ? null : inHand.windowsAt(technician.technician_id, date);
  return (
    <td className={away ? `${styles.cell ?? ""} ${styles.away ?? ""}` : styles.cell}>
      {away && <AwayMark technician={technician} date={date} blocks={blocks} />}
      {blocks.map((block) => (
        <BlockButton
          key={block.appointment_id}
          job={{ kind: "block", block, technician, date }}
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
            <button
              className={styles.target}
              key={window}
              type="button"
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
            </button>
          ))}
        </div>
      )}
    </td>
  );
}

interface GridProps {
  readonly board: Board;
  /** The technicians to draw: the board's, narrowed by what ops searched for. */
  readonly rows: readonly BoardRow[];
  readonly inHand: InHand | null;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: (job: Job, from: HTMLElement) => void;
  readonly onLand: (to: Target) => void;
}

export function Grid({ board, rows, inHand, onOpen, onTake, onLand }: GridProps) {
  return (
    <table className={styles.grid}>
      <thead>
        <tr>
          <td className={styles.corner} />
          {board.dates.map((date) => {
            const percent = board.utilisation.find((day) => day.date === date)?.percent ?? 0;
            return (
              <th className={styles.day} key={date} scope="col">
                <span className={styles.dayName}>{dayHead(date)}</span>
                <span className={percent >= dispatch.peak ? styles.peak : styles.util}>{dispatch.util(percent)}</span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((technician) => (
          <tr key={technician.technician_id}>
            <th className={styles.tech} scope="row">
              <span>{technician.name}</span>
              <span className={styles.zone}>{technician.zone ?? dispatch.unknown}</span>
            </th>
            {board.dates.map((date) => (
              <Cell
                away={isAway(board.leave, technician.technician_id, date)}
                blocks={technician.days.find((day) => day.date === date)?.blocks ?? []}
                date={date}
                inHand={inHand}
                key={date}
                onLand={onLand}
                onOpen={onOpen}
                onTake={onTake}
                technician={technician}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
