// The dispatch board (Ops Console, boards A1, A2 and A3): active technicians
// down, seven days across, four slots a day, and the jobs nobody holds yet in
// a tray on the right (src/policy/dispatch.ts).
//
// A job is moved by dragging it onto a technician's window, or, without a
// mouse, by opening it and choosing a window from the board. Either way the
// reason picker (A2) comes before anything is written: the clash check runs on
// the server before any write to FSM (docs/decisions/0034-clash-check.md), and
// a refusal names the technician and the window the board asked for, because
// the API answers with the code alone.
//
// A day a technician is away takes no job: the cell offers no window to drop
// on, and the server refuses the move by name if one is sent anyway (ADR 0062).
// The tray's asked window is what the client picked, and a visit whose booking
// recorded none says so rather than repeating the offered one (ADR 0063).

import { shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Block,
  type Board,
  type BoardRow,
  type BookingWindow,
  type Landing,
  type MoveReason,
} from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { BlockDrawer } from "./BlockDrawer.tsx";
import styles from "./dispatch.module.css";
import { idOf, nameOf, WINDOWS, type Job, type Target } from "./job.ts";
import { MovePicker } from "./MovePicker.tsx";

/** A move in hand: the job, where it is going once a window is chosen, and why it was refused. */
interface Move {
  readonly job: Job;
  readonly to: Target | null;
  readonly sending: boolean;
  readonly refusal: string | null;
}

const windowWord = (window: BookingWindow | null) =>
  window === null ? dispatch.unknown : (dispatch.windows[window] ?? window);

/** "Sat, morning", as the tray writes a job's day and window. */
const whenWord = (date: string | null, window: BookingWindow | null) =>
  date === null ? windowWord(window) : `${shortDate(date).slice(0, 3)}, ${windowWord(window)}`;

/** "Fri 19", as a column is headed. */
const dayHead = (date: string) => shortDate(date).split(" ").slice(0, 2).join(" ");

/** Why a move was refused, in the board's words. Nothing was written either way. */
function refusalFor(code: string): string {
  const errors: Readonly<Record<string, string | undefined>> = dispatch.landing.errors;
  return errors[code] ?? dispatch.landing.errors.unknown;
}

/** Leave covers whole days, both ends included, and the route clips it to this week. */
const isAway = (leave: Board["leave"], technicianId: string, date: string) =>
  leave.some((period) => period.technician_id === technicianId && period.from <= date && date <= period.to);

/** "19 to 25 Sep", and "28 Sep to 4 Oct" across a month's end. */
function weekOf(dates: readonly string[]): string | undefined {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const from = shortDate(first).slice(4);
  const to = shortDate(last).slice(4);
  const sameMonth = from.slice(from.indexOf(" ")) === to.slice(to.indexOf(" "));
  return dispatch.week(sameMonth ? from.slice(0, from.indexOf(" ")) : from, to);
}

/** A block's second line: "Sec 65 · service". */
const whatOf = (block: Block) =>
  [block.sector, block.type === null ? null : dispatch.types[block.type]]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");

/** The board's three inks: a first fit on ink, a replacement shaded, everything else on light paper. */
const inkOf = (block: Block) =>
  block.type === "first_fit" ? styles.fit : block.type === "replacement" ? styles.repl : styles.svc;

/** "Blocks are sized by slot: consultation and service 1, replacement 1.5, first fit 2." */
const sizeOf = (block: Block) => (block.slots >= 2 ? styles.slots2 : block.slots > 1 ? styles.slots15 : styles.slots1);

interface CellProps {
  readonly technician: BoardRow;
  readonly date: string;
  readonly blocks: readonly Block[];
  /** Ops recorded leave for this technician on this day, so it takes no job. */
  readonly away: boolean;
  /** The job in hand, whose windows this cell offers while it is being placed. */
  readonly moving: Job | null;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onTake: (job: Job, from: HTMLElement) => void;
  readonly onLand: (to: Target) => void;
}

/**
 * One technician's day: the blocks on it, and, while a job is in hand, its
 * three windows. A day marked away still draws whatever it holds — leave
 * recorded after a job was assigned must not hide that job — and offers no
 * window to put another one in.
 */
function Cell({ technician, date, blocks, away, moving, onOpen, onTake, onLand }: CellProps) {
  return (
    <td className={away ? `${styles.cell} ${styles.away}` : styles.cell}>
      {away && (
        <span className={styles.awayMark} aria-label={dispatch.board.awayLabel(technician.name, shortDate(date))}>
          {dispatch.board.away}
        </span>
      )}
      {blocks.map((block) => {
        const job: Job = { kind: "block", block, technician, date };
        return (
          <button
            className={`${styles.block} ${inkOf(block)} ${sizeOf(block)}`}
            key={block.appointment_id}
            type="button"
            draggable
            aria-label={dispatch.board.block(nameOf(job), shortDate(date), windowWord(block.window))}
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
      })}
      {moving !== null && !away && (
        <div className={styles.targets}>
          {WINDOWS.map((window) => (
            <button
              className={styles.target}
              key={window}
              type="button"
              aria-label={dispatch.landing.choose(nameOf(moving), technician.name, shortDate(date), windowWord(window))}
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

export function DispatchScreen() {
  const [loaded, retry] = useLoad(api.board);
  const [opened, setOpened] = useState<Job | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  const opener = useRef<HTMLElement | null>(null);
  const board = useRef<HTMLDivElement>(null);

  const restore = useCallback(() => {
    const from = opener.current;
    opener.current = null;
    if (from?.isConnected === true) from.focus();
    else board.current?.focus();
  }, []);

  const open = useCallback((job: Job, from: HTMLElement) => {
    opener.current = from;
    setDone(null);
    setOpened(job);
  }, []);

  const take = useCallback((job: Job, from: HTMLElement | null) => {
    opener.current = from;
    setOpened(null);
    setDone(null);
    setMove({ job, to: null, sending: false, refusal: null });
  }, []);

  const land = useCallback((to: Target) => {
    setMove((held) => (held === null ? null : { ...held, to, refusal: null }));
  }, []);

  /** Back to the board with the job still in hand, and the keyboard back on the board with it. */
  const unpick = useCallback(() => {
    setMove((held) => (held === null ? null : { ...held, to: null, sending: false }));
    board.current?.focus();
  }, []);

  const stop = useCallback(() => {
    setMove(null);
    restore();
  }, [restore]);

  const closeDrawer = useCallback(() => {
    setOpened(null);
    restore();
  }, [restore]);

  const send = useCallback(
    async (reason: MoveReason) => {
      const to = move?.to ?? null;
      if (move === null || to === null) return;
      const { job } = move;
      setMove({ ...move, sending: true });

      const landing: Landing = { technicianId: to.technician.technician_id, date: to.date, window: to.window, reason };
      const answer = job.kind === "block" ? await api.move(idOf(job), landing) : await api.assign(idOf(job), landing);

      if (answer.ok) {
        setMove(null);
        setDone(dispatch.landing.moved(nameOf(job)));
        opener.current = null;
        board.current?.focus();
        retry();
        return;
      }
      // Nothing was written: the check runs before FSM is touched. The API answers
      // with the code alone, so the board names what it asked for itself.
      const refusal =
        answer.code === "clash"
          ? dispatch.landing.clash(to.technician.name, shortDate(to.date), windowWord(to.window))
          : answer.code === "on_leave"
            ? dispatch.landing.onLeave(to.technician.name, shortDate(to.date))
            : refusalFor(answer.code);
      setMove({ job, to: null, sending: false, refusal });
      board.current?.focus();
    },
    [move, retry],
  );

  // Escape lets go: of the picker back to the board, of the drawer, of the move.
  useEffect(() => {
    if (move === null && opened === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (opened !== null) {
        closeDrawer();
        return;
      }
      if (move === null) return;
      if (move.to === null) stop();
      else unpick();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [move, opened, closeDrawer, stop, unpick]);

  const week = loaded.state === "loaded" ? weekOf(loaded.value.dates) : undefined;
  /** The job in hand while a window is still to be chosen; nothing while the picker is open. */
  const placing = move === null ? null : move.to === null ? move.job : null;
  const refusal = move?.refusal ?? null;
  /** The move once a window is chosen, which is board A2 open over the board. */
  const picking = move === null ? null : move.to === null ? null : { ...move, to: move.to };
  const dialog = opened !== null || picking !== null;

  return (
    <Shell section="/dispatch" title={dispatch.title} sub={week} flush>
      <div className={styles.area} inert={dialog}>
        {loaded.state === "loading" ? (
          <Loading />
        ) : loaded.state === "failed" ? (
          <PanelFailed onRetry={retry} />
        ) : (
          <>
            <div className={styles.main} ref={board} tabIndex={-1}>
              {move !== null && (
                <div className={styles.bar}>
                  <p className={styles.barText}>{dispatch.landing.moving(nameOf(move.job))}</p>
                  <button className={styles.quiet} type="button" onClick={stop}>
                    {dispatch.landing.stop}
                  </button>
                </div>
              )}
              {refusal !== null && (
                <p className={styles.refusal} role="alert">
                  {refusal}
                </p>
              )}
              {done !== null && (
                <p className={styles.done} role="status">
                  {done}
                </p>
              )}
              <div className={styles.scroll}>
                {loaded.value.technicians.length === 0 ? (
                  <p className={styles.empty}>{dispatch.board.empty}</p>
                ) : (
                  <table className={styles.grid}>
                    <thead>
                      <tr>
                        <td className={styles.corner} />
                        {loaded.value.dates.map((date) => {
                          const percent = loaded.value.utilisation.find((day) => day.date === date)?.percent ?? 0;
                          return (
                            <th className={styles.day} key={date} scope="col">
                              <span className={styles.dayName}>{dayHead(date)}</span>
                              <span className={percent >= dispatch.peak ? styles.peak : styles.util}>
                                {dispatch.util(percent)}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {loaded.value.technicians.map((technician) => (
                        <tr key={technician.technician_id}>
                          <th className={styles.tech} scope="row">
                            <span>{technician.name}</span>
                            <span className={styles.zone}>{technician.zone ?? dispatch.unknown}</span>
                          </th>
                          {loaded.value.dates.map((date) => (
                            <Cell
                              away={isAway(loaded.value.leave, technician.technician_id, date)}
                              blocks={technician.days.find((day) => day.date === date)?.blocks ?? []}
                              date={date}
                              key={date}
                              moving={placing}
                              onLand={land}
                              onOpen={open}
                              onTake={take}
                              technician={technician}
                            />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className={styles.note}>{dispatch.board.leave}</p>
            </div>

            <aside className={styles.tray} aria-labelledby="unassigned">
              <div className={styles.trayHead}>
                <h2 className={styles.trayTitle} id="unassigned">
                  {dispatch.tray.title}
                </h2>
                <span className={styles.count}>{loaded.value.unassigned.length}</span>
              </div>
              {loaded.value.unassigned.length === 0 ? (
                <p className={styles.empty}>{dispatch.tray.empty}</p>
              ) : (
                <ul className={styles.trayList}>
                  {loaded.value.unassigned.map((each) => {
                    const job: Job = { kind: "unassigned", job: each };
                    return (
                      <li key={each.appointment_id}>
                        <button
                          className={styles.trayJob}
                          type="button"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", each.appointment_id);
                            take(job, event.currentTarget);
                          }}
                          onClick={(event) => {
                            take(job, event.currentTarget);
                          }}
                        >
                          <span className={styles.trayTop}>
                            <span>{each.sector ?? dispatch.unknown}</span>
                            <span className={styles.trayType}>
                              {each.type === null ? dispatch.unknown : (dispatch.typeNames[each.type] ?? each.type)}
                            </span>
                          </span>
                          <span className={styles.trayLine}>
                            {each.asked_window === null
                              ? dispatch.tray.notAsked
                              : dispatch.tray.asked(whenWord(each.date, each.asked_window))}
                          </span>
                          <span className={styles.trayLine}>
                            {dispatch.tray.offered(whenWord(each.date, each.offered_window))}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className={styles.note}>{dispatch.tray.same}</p>
            </aside>
          </>
        )}
      </div>

      {opened !== null && opened.kind === "block" && (
        <BlockDrawer
          job={opened}
          onClose={closeDrawer}
          onMove={() => {
            take(opened, opener.current);
          }}
        />
      )}
      {picking !== null && (
        <MovePicker
          job={picking.job}
          onCancel={unpick}
          onSend={(reason) => void send(reason)}
          sending={picking.sending}
          to={picking.to}
        />
      )}
    </Shell>
  );
}
