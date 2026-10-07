// The dispatch board: active technicians
// down, seven days across, four slots a day, and the jobs nobody holds yet in
// a tray on the right (src/policy/dispatch.ts).
//
// A job is moved by dragging it onto a technician's window, or, without a
// mouse, by opening it and choosing a destination from a list. Either way the
// board first asks where the job would land, and offers only those windows;
// then the reason picker comes before anything is written. The server
// checks again before anything is written (docs/decisions/0034-clash-check.md)
// and refuses a move made from a board that has gone stale
// (docs/decisions/0069-dispatch-under-concurrency.md). A refusal names the
// technician and the window the board asked for, because the API answers with
// the code alone.
//
// The board reads itself again when something on it has changed (useBoard.ts),
// and after a move, without the loading state: the grid keeps its scroll, and
// the keyboard goes back to the block that moved.
//
// A link may open the board on a week, a city, a search and a visit
// ("?from=2026-10-12&find=Imran&visit=…"), as Tasks, a client's visits, a
// technician's leave and blackout days do; the visit's drawer opens. The address
// keeps all four as ops change them (./address.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Answer, type Board, type BoardQuery, type Landing, type Moved, type MoveReason } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { useAddressKeeps } from "./address.ts";
import styles from "./dispatch.module.css";
import { Grid, type InHand } from "./Grid.tsx";
import { dispatchAsked } from "../route.ts";
import { blockOn, idOf, shownOf, type Job, type Target } from "./job.ts";
import { MoveBar } from "./MoveBar.tsx";
import { MovePicker } from "./MovePicker.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Tray } from "./Tray.tsx";
import { useBoard } from "./useBoard.ts";
import { answersTo, foundBy, weekOf } from "./board-view.ts";
import { ChangePanel, changedNotice, type Changing } from "./ChangePanel.tsx";
import { doneNotice, moveRefusal, STALE, staleWords, type Notice } from "./landing.ts";
import { NoticeLine } from "./NoticeLine.tsx";
import { OpenedDrawer } from "./OpenedDrawer.tsx";
import { isBlackout, landsAtFrom, useRooms, windowsFrom } from "./rooms.ts";

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

export function DispatchScreen() {
  const [asked] = useState(() => dispatchAsked(window.location.search));
  const [query, setQuery] = useState<BoardQuery>({ from: asked.from, city: asked.city });
  const [find, setFind] = useState(asked.find);
  const [opened, setOpened] = useState<Job | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [changing, setChanging] = useState<Changing | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { loaded, last, refresh, retry } = useBoard(query, move !== null || opened !== null || changing !== null);
  const board = loaded.state === "loaded" ? loaded.value : null;
  const access = useAccess();
  const mayMove = access.mayCall("POST /api/dispatch/move");
  const mayAssign = access.mayCall("POST /api/dispatch/assign");

  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  const opener = useRef<HTMLElement | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** The visit a link asked for, until the first board read shows it. */
  const askedVisit = useRef(asked.visit);

  useAddressKeeps(query, find, opened === null ? null : idOf(opened));

  /** Brings a visit into view: its block, with its drawer open, or its place in the tray; else says it is not here. */
  const showVisit = useCallback((on: Board, visit: string) => {
    const element = area.current?.querySelector<HTMLElement>(`[data-appointment="${visit}"]`) ?? null;
    element?.scrollIntoView({ block: "center", inline: "nearest" });
    // The keyboard goes to the visit first, so the browser gives it back there when the drawer closes.
    element?.focus();
    const job = blockOn(on, visit);
    if (job !== null) {
      opener.current = element;
      setOpened(job);
      return;
    }
    const inTray = on.unassigned.find((each) => each.appointment_id === visit);
    if (inTray === undefined) {
      setNotice({ tone: "refusal", text: dispatch.landing.notOnBoard, call: null });
      return;
    }
    opener.current = element;
    setOpened({ kind: "unassigned", job: inTray });
  }, []);

  useEffect(() => {
    const visit = askedVisit.current;
    if (board === null || visit === null) return;
    askedVisit.current = null;
    showVisit(board, visit);
  }, [board, showVisit]);

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

  // Where the job in hand would land in the week on screen, so the board offers only those windows.
  const [rooms, askRooms] = useRooms(move === null ? null : idOf(move.job), board?.from ?? null);

  const open = useCallback((job: Job, from: HTMLElement) => {
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
      askRooms();
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

  /** Back to the board with the job still in hand. Not while it is being sent: it could be sent twice. */
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
    async (reason: MoveReason, blackoutReason: string | null) => {
      const to = move?.to ?? null;
      if (move === null || to === null || move.sending) return;
      const { job } = move;
      setMove({ ...move, sending: true });

      const landing: Landing = {
        technicianId: to.technician.technician_id,
        date: to.date,
        window: to.window,
        reason,
        blackoutReason,
      };
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
      setNotice({ tone: "refusal", text: moveRefusal(job, to, answer.code), call: null });
      askRooms();
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
  const found = useMemo(() => foundBy(board, find), [board, find]);
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
                    found={found}
                    onOpen={open}
                    onTake={mayMove ? take : null}
                    onLand={land}
                  />
                )}
              </div>
            </>
          )}
        </div>
        {board !== null && <Tray unassigned={board.unassigned} onOpen={open} onTake={mayAssign ? take : null} />}
      </div>

      {opened !== null && (
        <OpenedDrawer
          opened={opened}
          access={access}
          onClose={closeDrawer}
          onTake={(job, clearingCheckIn) => {
            take(job, opener.current, clearingCheckIn);
          }}
          onTold={(moveId, name) => {
            setOpened(null);
            void told(moveId, name).then(restore);
          }}
          onChange={(next) => {
            setOpened(null);
            setNotice(null);
            setChanging(next);
          }}
        />
      )}
      {changing !== null && <ChangePanel changing={changing} onClose={(done) => void changed(done)} />}
      {picking !== null && (
        <MovePicker
          job={picking.job}
          onCancel={unpick}
          onSend={(reason, blackoutReason) => void send(reason, blackoutReason)}
          sending={picking.sending}
          clearingCheckIn={picking.clearingCheckIn}
          to={picking.to}
          landsAt={landsAtFrom(rooms, picking.to)}
          blackout={isBlackout(rooms, picking.to.date)}
        />
      )}
    </Shell>
  );
}
