// The dispatch board: active technicians down, seven days across, and the jobs nobody holds in a tray
// (src/policy/dispatch.ts). A job is moved by dragging it or from its drawer: the board offers only the windows it
// would land in and asks a reason, and the server checks again (docs/decisions/0034-clash-check.md,
// 0069-dispatch-under-concurrency.md). The address keeps the week, city, search and visit (./address.ts).

import { EmptyState } from "@maneman/ui/EmptyState";
import { useCallback, useMemo, useRef, useState } from "react";
import type { BoardQuery } from "../api.ts";
import { useHeaderSub } from "../components/Shell.tsx";
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
import { useSearch, weekOf } from "./board-view.ts";
import { ChangePanel, changedNotice, type Changing } from "./ChangePanel.tsx";
import type { Notice } from "./landing.ts";
import { NoticeLine } from "./NoticeLine.tsx";
import { OpenedDrawer } from "./OpenedDrawer.tsx";
import { DayRoutes } from "./DayRoutes.tsx";
import { isBlackout, kmFrom, landsAtFrom, windowsFrom } from "./rooms.ts";
import { useAskedVisit, useClientCalls } from "./useBoardCalls.ts";
import { useMove, type Move } from "./useMove.ts";

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
  useHeaderSub(board === null ? undefined : weekOf(board.dates));
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

  const { settled, rows, found } = useSearch(board, find);
  const inHand = useMemo(
    (): InHand | null =>
      choosing && move !== null ? { job: move.job, windowsAt: windowsFrom(rooms), kmAt: kmFrom(rooms) } : null,
    [choosing, move, rooms],
  );
  const chosen = move?.to ?? null;
  const picking = move === null || chosen === null ? null : { ...move, to: chosen };

  return (
    <>
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
            <div className={styles.scroll}>
              {board.technicians.length === 0 && <EmptyState look="panel" line={dispatch.board.empty} />}
              {board.technicians.length > 0 && rows.length === 0 && (
                <EmptyState look="panel" line={dispatch.tools.nothingFound(settled.trim())} />
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
    </>
  );
}
