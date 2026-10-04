// The dispatch board (Ops Console, boards A1, A2 and A3): active technicians
// down, seven days across, four slots a day, and the jobs nobody holds yet in
// a tray on the right (src/policy/dispatch.ts).
//
// A job is moved by dragging it onto a technician's window, or, without a
// mouse, by opening it and choosing a destination from a list. Either way the
// board first asks where the job would land, and offers only those windows;
// then the reason picker (A2) comes before anything is written. The server
// checks again before anything is written (docs/decisions/0034-clash-check.md)
// and refuses a move made from a board that has gone stale
// (docs/decisions/0069-dispatch-under-concurrency.md). A refusal names the
// technician and the window the board asked for, because the API answers with
// the code alone.
//
// The board reads itself again every minute and when the tab comes back, and
// after a move, without the loading state: the grid keeps its scroll, and the
// keyboard goes back to the block that moved.

import { Button } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Answer,
  type Board,
  type BoardQuery,
  type BoardRow,
  type BookingWindow,
  type Landing,
  type Moved,
  type MoveReason,
  type Room,
} from "../api.ts";
import { CancelVisit } from "../clients/CancelVisit.tsx";
import { CloseVisit } from "../clients/CloseVisit.tsx";
import { Shell } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { useAccess, type Access } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { BlockDrawer } from "./BlockDrawer.tsx";
import styles from "./dispatch.module.css";
import { Grid, type InHand } from "./Grid.tsx";
import { phoneWords } from "../lib/phone.ts";
import {
  changeOf,
  idOf,
  nameOf,
  personOf,
  shownOf,
  WINDOWS,
  type BlockJob,
  type Job,
  type Target,
  type VisitChange,
} from "./job.ts";
import { MoveBar } from "./MoveBar.tsx";
import { MovePicker } from "./MovePicker.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Tray } from "./Tray.tsx";
import { useBoard } from "./useBoard.ts";

/** Where the job in hand would land, as the server answered; "unknown" if it could not, and every window is offered. */
type Rooms =
  | { readonly state: "checking" }
  | { readonly state: "known"; readonly rooms: readonly Room[] }
  | { readonly state: "unknown" };

/**
 * A move in hand: the job, the window chosen for it, whether it is being sent, and whether ops chose, after the
 * drawer's warning, to clear the technician's check-in.
 */
interface Move {
  readonly job: Job;
  readonly to: Target | null;
  readonly sending: boolean;
  readonly clearingCheckIn: boolean;
}

/** A line over the board: what a move did, or why it was refused. A call still to make carries its move. */
interface Notice {
  readonly tone: "done" | "refusal";
  readonly text: string;
  readonly call: { readonly moveId: string; readonly name: string } | null;
}

const windowWord = (window: BookingWindow) => dispatch.windows[window] ?? window;

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

/** Whether a row answers to what ops searched for: the technician's name or zone, or a client on one of his days. */
function answersTo(row: BoardRow, find: string): boolean {
  const wanted = find.trim().toLowerCase();
  if (wanted === "") return true;
  const clients = row.days.flatMap((day) => day.blocks.flatMap((block) => [block.client, block.person?.name ?? null]));
  return [row.name, row.zone, ...clients].some((word) => word?.toLowerCase().includes(wanted) === true);
}

/** The windows each day offers the job in hand: the server's answer; every window if it could not answer. */
function windowsFrom(rooms: Rooms): InHand["windowsAt"] {
  if (rooms.state === "checking") return () => null;
  if (rooms.state === "unknown") return () => WINDOWS;
  return (technicianId, date) =>
    rooms.rooms.find((room) => room.technician_id === technicianId && room.date === date)?.windows ?? [];
}

/** What a move did, in words, from the server's own answer: a message is claimed only where one was queued. */
function doneNotice(job: Job, to: Target, moved: Moved): Notice {
  const copy = dispatch.landing.moved;
  const name = nameOf(job);
  const person = personOf(job);
  if (moved.client_notice === "messaged") return { tone: "done", text: copy.messaged(name), call: null };
  if (moved.client_notice === "unchanged") {
    return { tone: "done", text: copy.unchanged(name, to.technician.name), call: null };
  }
  if (moved.client_notice === "call" && person !== null) {
    return {
      tone: "done",
      text: copy.call(name, person.name, phoneWords(person.mobile)),
      call: { moveId: moved.move_id, name: person.name },
    };
  }
  return { tone: "done", text: copy.noClient(name), call: null };
}

/** Why a move was refused, in the board's words. Nothing was written either way. */
function refusalOf(job: Job, to: Target, code: string): string {
  const copy = dispatch.landing;
  if (code === "clash") return copy.clash(to.technician.name, shortDate(to.date), windowWord(to.window));
  if (code === "on_leave") return copy.onLeave(to.technician.name, shortDate(to.date));
  if (code === "does_not_fit") {
    const type = job.kind === "block" ? job.block.type : job.job.type;
    const typeName = type === null ? nameOf(job) : (dispatch.typeNames[type] ?? type);
    return copy.doesNotFit(typeName, to.technician.name, shortDate(to.date), windowWord(to.window));
  }
  const errors: Readonly<Record<string, string | undefined>> = copy.errors;
  return errors[code] ?? copy.errors.unknown;
}

/** Where a job is on a board, and whether it is where the board it was taken from had it. */
function placeOn(board: Board, job: Job): { readonly words: string; readonly unchanged: boolean } | null {
  const shown = shownOf(job);
  for (const row of board.technicians) {
    for (const day of row.days) {
      const block = day.blocks.find((each) => each.appointment_id === idOf(job));
      if (block === undefined) continue;
      return {
        words: dispatch.landing.supersededWhere(row.name, shortDate(day.date), windowWord(block.window)),
        unchanged: row.technician_id === shown.technicianId && block.starts_at === shown.startsAt,
      };
    }
  }
  return null;
}

/**
 * What a move refused as stale says, from the board read again: another move
 * of the same job still being written leaves it where it was; a move already
 * made has put it somewhere else.
 */
function staleWords(job: Job, code: string, now: Board | null): string {
  const copy = dispatch.landing;
  if (code === "not_found") return copy.errors.not_found;
  if (code === "in_progress") return copy.errors.in_progress;
  const place = now === null ? null : placeOn(now, job);
  if (place?.unchanged === true) return copy.beingMoved(nameOf(job));
  return copy.superseded(nameOf(job), place?.words ?? copy.supersededGone);
}

/** Refusals that mean the job is no longer as the board had it: it is let go, and the board read again. */
const STALE = new Set(["superseded", "not_found", "in_progress"]);

/** A visit being cancelled or closed by hand, in its own panel, opened from its drawer. */
interface Changing {
  readonly job: BlockJob;
  readonly change: VisitChange;
}

/** The change a block's visit takes now, if the person's access reaches it. */
function changeFor(job: BlockJob, access: Access): VisitChange | null {
  const change = changeOf(job.block, Date.now());
  if (change === "cancel" && access.mayCall("POST /api/visits/{id}/cancel")) return change;
  if (change === "close" && access.mayCall("POST /api/visits/{id}/close")) return change;
  return null;
}

/** What a cancel or a close by hand did, over the board once its panel closes. */
function changedNotice(changing: Changing): Notice {
  const name = nameOf(changing.job);
  const text = changing.change === "cancel" ? dispatch.landing.cancelled(name) : dispatch.landing.closedByHand(name);
  return { tone: "done", text, call: null };
}

function ChangePanel({ changing, onClose }: { changing: Changing; onClose: (changed: boolean) => void }) {
  const { job, change } = changing;
  const name = job.block.person?.name ?? nameOf(job);
  if (change === "cancel") return <CancelVisit visitId={idOf(job)} name={name} onClose={onClose} />;
  return <CloseVisit visitId={idOf(job)} name={name} date={job.date} onClose={onClose} />;
}

export function DispatchScreen() {
  const [query, setQuery] = useState<BoardQuery>({ from: null, city: null });
  const [find, setFind] = useState("");
  const [opened, setOpened] = useState<BlockJob | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [changing, setChanging] = useState<Changing | null>(null);
  const [rooms, setRooms] = useState<Rooms>({ state: "checking" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const { loaded, last, refresh, retry } = useBoard(query, move !== null || opened !== null || changing !== null);
  const board = loaded.state === "loaded" ? loaded.value : null;
  const access = useAccess();
  const mayMove = access.mayCall("POST /api/dispatch/move");
  const mayAssign = access.mayCall("POST /api/dispatch/assign");
  const mayTell = access.mayCall("POST /api/dispatch/moves/{id}/told");

  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  const opener = useRef<HTMLElement | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const restore = useCallback(() => {
    const from = opener.current;
    opener.current = null;
    if (from?.isConnected === true) from.focus();
    else area.current?.focus();
  }, []);

  /** After the board is read again, the keyboard goes to the block that moved, wherever it now is. */
  const focusBlock = useCallback((appointmentId: string) => {
    const moved = area.current?.querySelector<HTMLElement>(`[data-appointment="${appointmentId}"]`) ?? null;
    if (moved === null) area.current?.focus();
    else moved.focus();
  }, []);

  /** Asks where the job would land in the week on screen, so the board offers only those windows. */
  const askRooms = useCallback(
    (job: Job) => {
      setRooms({ state: "checking" });
      if (board === null) {
        setRooms({ state: "unknown" });
        return;
      }
      void api.room(idOf(job), board.from).then((answer) => {
        setRooms(answer.ok ? { state: "known", rooms: answer.body.rooms } : { state: "unknown" });
      });
    },
    [board],
  );

  const open = useCallback((job: Job, from: HTMLElement) => {
    if (job.kind !== "block") return;
    opener.current = from;
    setNotice(null);
    setOpened(job);
  }, []);

  const take = useCallback(
    (job: Job, from: HTMLElement | null, clearingCheckIn = false) => {
      opener.current = from;
      setOpened(null);
      setNotice(null);
      setMove({ job, to: null, sending: false, clearingCheckIn });
      askRooms(job);
    },
    [askRooms],
  );

  /** A job taken up, with no window chosen for it yet. */
  const choosing = move?.to === null;
  // The keyboard follows a job taken up: to the bar that says what is moving and holds the list.
  const taken = choosing && !move.sending;
  useEffect(() => {
    if (taken) bar.current?.focus();
  }, [taken]);

  const land = useCallback((to: Target) => {
    setMove((held) => (held === null || held.sending ? held : { ...held, to }));
  }, []);

  /** Back to the board with the job still in hand. Not while it is being sent: it could be sent twice (FEO-04). */
  const unpick = useCallback(() => {
    setMove((held) => (held === null || held.sending ? held : { ...held, to: null }));
  }, []);

  const stop = useCallback(() => {
    if (move?.sending === true) return;
    setMove(null);
    restore();
  }, [move, restore]);

  const closeDrawer = useCallback(() => {
    setOpened(null);
    restore();
  }, [restore]);

  /** The panel closed: a visit cancelled or closed leaves the board as it was read, so it is read again. */
  const changed = useCallback(
    async (done: boolean) => {
      const was = changing;
      setChanging(null);
      if (!done || was === null) {
        restore();
        return;
      }
      opener.current = null;
      setNotice(changedNotice(was));
      await refresh();
      area.current?.focus();
    },
    [changing, refresh, restore],
  );

  /** Ops called a client who had not heard of a move: its task leaves the Tasks board. */
  const told = useCallback(
    async (moveId: string, name: string) => {
      const answer = await api.toldByPhone(moveId);
      if (!answer.ok) {
        setNotice({ tone: "refusal", text: dispatch.landing.toldFailed, call: { moveId, name } });
        return;
      }
      setNotice({ tone: "done", text: dispatch.landing.toldDone(name), call: null });
      await refresh();
    },
    [refresh],
  );

  const send = useCallback(
    async (reason: MoveReason) => {
      const to = move?.to ?? null;
      if (move === null || to === null || move.sending) return;
      const { job } = move;
      setMove({ ...move, sending: true });

      const landing: Landing = { technicianId: to.technician.technician_id, date: to.date, window: to.window, reason };
      const shown = shownOf(job);
      const answer: Answer<Moved> =
        job.kind === "block"
          ? await api.move(idOf(job), landing, shown, move.clearingCheckIn)
          : await api.assign(idOf(job), landing, shown);

      if (answer.ok) {
        setMove(null);
        setNotice(doneNotice(job, to, answer.body));
        opener.current = null;
        await refresh();
        focusBlock(idOf(job));
        return;
      }
      if (STALE.has(answer.code)) {
        // Someone else moved it, or is moving it: the board is read again, and says where it now is.
        setMove(null);
        const now = await refresh();
        setNotice({ tone: "refusal", text: staleWords(job, answer.code, now), call: null });
        area.current?.focus();
        return;
      }
      // Nothing was written: the job stays in hand, and the board asks again where it fits.
      setMove({ ...move, to: null, sending: false });
      setNotice({ tone: "refusal", text: refusalOf(job, to, answer.code), call: null });
      askRooms(job);
    },
    [move, refresh, focusBlock, askRooms],
  );

  // Escape lets go of the move in hand when no panel is open; an open panel closes itself.
  useEffect(() => {
    if (!choosing || opened !== null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [choosing, opened, stop]);

  const rows = useMemo(
    () => (board === null ? [] : board.technicians.filter((row) => answersTo(row, find))),
    [board, find],
  );
  const inHand = useMemo(
    (): InHand | null => (choosing ? { job: move.job, windowsAt: windowsFrom(rooms) } : null),
    [choosing, move, rooms],
  );
  const chosen = move?.to ?? null;
  const picking = move === null || chosen === null ? null : { ...move, to: chosen };

  return (
    <Shell section="/dispatch" title={dispatch.title} sub={board === null ? undefined : weekOf(board.dates)} flush>
      <div className={styles.area} ref={area} tabIndex={-1}>
        <div className={styles.main}>
          <Toolbar board={last} query={query} onQuery={setQuery} find={find} onFind={setFind} />
          {inHand !== null && (
            <MoveBar
              ref={bar}
              inHand={inHand}
              checking={rooms.state === "checking"}
              rows={rows}
              dates={board?.dates ?? []}
              onLand={land}
              onStop={stop}
            />
          )}
          {notice !== null && <NoticeLine notice={notice} onTold={told} />}
          {loaded.state === "loading" && <Loading />}
          {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
          {board !== null && (
            <>
              <div className={styles.scroll}>
                {board.technicians.length === 0 && <p className={styles.empty}>{dispatch.board.empty}</p>}
                {board.technicians.length > 0 && rows.length === 0 && (
                  <p className={styles.empty}>{dispatch.tools.nothingFound(find.trim())}</p>
                )}
                {rows.length > 0 && (
                  <Grid
                    board={board}
                    rows={rows}
                    inHand={inHand}
                    onOpen={open}
                    onTake={mayMove ? take : null}
                    onLand={land}
                  />
                )}
              </div>
              <p className={styles.note}>{dispatch.board.leave}</p>
            </>
          )}
        </div>
        {board !== null && <Tray unassigned={board.unassigned} onTake={mayAssign ? take : null} />}
      </div>

      {opened !== null && (
        <BlockDrawer
          job={opened}
          onClose={closeDrawer}
          onMove={
            mayMove
              ? () => {
                  take(opened, opener.current);
                }
              : null
          }
          onMoveAnyway={
            mayMove
              ? () => {
                  take(opened, opener.current, true);
                }
              : null
          }
          onTold={
            mayTell
              ? (moveId) => {
                  setOpened(null);
                  void told(moveId, opened.block.person?.name ?? nameOf(opened)).then(restore);
                }
              : null
          }
          change={changeFor(opened, access)}
          onChange={(change) => {
            setOpened(null);
            setNotice(null);
            setChanging({ job: opened, change });
          }}
        />
      )}
      {changing !== null && <ChangePanel changing={changing} onClose={(done) => void changed(done)} />}
      {picking !== null && (
        <MovePicker
          job={picking.job}
          onCancel={unpick}
          onSend={(reason) => void send(reason)}
          sending={picking.sending}
          clearingCheckIn={picking.clearingCheckIn}
          to={picking.to}
        />
      )}
    </Shell>
  );
}

/** What a move did or why it was refused; a call still to make carries the button that records it. */
function NoticeLine({ notice, onTold }: { notice: Notice; onTold: (moveId: string, name: string) => Promise<void> }) {
  const done = notice.tone === "done";
  return (
    <div className={done ? styles.done : styles.refusal} role={done ? "status" : "alert"}>
      <p className={styles.noticeText}>{notice.text}</p>
      {notice.call !== null && (
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            if (notice.call !== null) void onTold(notice.call.moveId, notice.call.name);
          }}
        >
          {dispatch.landing.told}
        </Button>
      )}
    </div>
  );
}
