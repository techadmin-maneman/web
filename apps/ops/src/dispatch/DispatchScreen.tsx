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

import { EmptyState } from "@maneman/ui/EmptyState";
import { useCallback, useMemo, useRef, useState } from "react";
import type { BoardQuery } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { useAddressKeeps } from "./address.ts";
import styles from "./dispatch.module.css";
import { Grid, type InHand } from "./Grid.tsx";
import { dispatchAsked } from "../route.ts";
import { idOf, type Job } from "./job.ts";
import { MoveBar } from "./MoveBar.tsx";
import { MovePicker } from "./MovePicker.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Tray } from "./Tray.tsx";
import { useBoard } from "./useBoard.ts";
import { answersTo, foundBy, weekOf } from "./board-view.ts";
import { ChangePanel, changedNotice, type Changing } from "./ChangePanel.tsx";
import type { Notice } from "./landing.ts";
import { NoticeLine } from "./NoticeLine.tsx";
import { OpenedDrawer } from "./OpenedDrawer.tsx";
import { DayRoutes } from "./DayRoutes.tsx";
import { isBlackout, kmFrom, landsAtFrom, windowsFrom } from "./rooms.ts";
import { useAskedVisit, useClientCalls } from "./use-board-calls.ts";
import { useMove, type Move } from "./use-move.ts";

export function DispatchScreen() {
  const [asked] = useState(() => dispatchAsked(window.location.search));
  const [query, setQuery] = useState<BoardQuery>({ from: asked.from, city: asked.city });
  const [find, setFind] = useState(asked.find);
  const [opened, setOpened] = useState<Job | null>(null);
  const [changing, setChanging] = useState<Changing | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [routesOn, setRoutesOn] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const { loaded, last, refresh, retry } = useBoard(query, move !== null || opened !== null || changing !== null);
  const board = loaded.state === "loaded" ? loaded.value : null;
  const access = useAccess();

  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  const opener = useRef<HTMLElement | null>(null);
  const area = useRef<HTMLDivElement>(null);

  useAddressKeeps(query, find, opened === null ? null : idOf(opened));
  useAskedVisit({ board, visit: asked.visit, area, opener, setOpened, setNotice });
  const { told, withdraw } = useClientCalls(refresh, setNotice);

  const restore = useCallback(() => {
    const from = opener.current;
    opener.current = null;
    if (from?.isConnected === true) from.focus();
    else area.current?.focus();
  }, []);

  const { rooms, choosing, bar, take, land, unpick, stop, send } = useMove([move, setMove], {
    weekFrom: board?.from ?? null,
    opened,
    refresh,
    setNotice,
    setOpened,
    opener,
    area,
    restore,
  });

  const open = useCallback((job: Job, from: HTMLElement) => {
    opener.current = from;
    setNotice(null);
    setOpened(job);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpened(null);
    restore();
  }, [restore]);

  /** The panel closed: a visit cancelled or closed leaves the board as it was read, so it is read again. */
  const changed = async (done: boolean) => {
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
  };

  const rows = useMemo(
    () => (board === null ? [] : board.technicians.filter((row) => answersTo(row, find))),
    [board, find],
  );
  const found = useMemo(() => foundBy(board, find), [board, find]);
  const inHand = useMemo(
    (): InHand | null =>
      choosing && move !== null ? { job: move.job, windowsAt: windowsFrom(rooms), kmAt: kmFrom(rooms) } : null,
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
                {board.technicians.length === 0 && <EmptyState look="panel" line={dispatch.board.empty} />}
                {board.technicians.length > 0 && rows.length === 0 && (
                  <EmptyState look="panel" line={dispatch.tools.nothingFound(find.trim())} />
                )}
                {rows.length > 0 && (
                  <Grid
                    board={board}
                    rows={rows}
                    inHand={inHand}
                    found={found}
                    onOpen={open}
                    onTake={access.mayCall("POST /api/dispatch/move") ? take : null}
                    onLand={land}
                    onRoutes={access.mayCall("GET /api/dispatch/day") ? setRoutesOn : null}
                  />
                )}
              </div>
            </>
          )}
        </div>
        {board !== null && (
          <Tray
            unassigned={board.unassigned}
            onOpen={open}
            onTake={access.mayCall("POST /api/dispatch/assign") ? take : null}
          />
        )}
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
          onWithdraw={(proposalId, name) => {
            setOpened(null);
            void withdraw(proposalId, name).then(restore);
          }}
          onChange={(next) => {
            setOpened(null);
            setNotice(null);
            setChanging(next);
          }}
        />
      )}
      {routesOn !== null && (
        <DayRoutes
          date={routesOn}
          city={query.city}
          onClose={() => {
            setRoutesOn(null);
          }}
        />
      )}
      {changing !== null && <ChangePanel changing={changing} onClose={(done) => void changed(done)} />}
      {picking !== null && (
        <MovePicker
          job={picking.job}
          onCancel={unpick}
          onSend={(reason, blackoutReason, asking) => {
            send({ reason, blackoutReason, asking });
          }}
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
