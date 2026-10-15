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
import styles from "./dispatch-screen.module.css";
import { Grid, type InHand } from "./Grid.tsx";
import { dispatchAsked } from "../route.ts";
import { idOf, type Job } from "./job.ts";
import { MoveBar } from "./MoveBar.tsx";
import { MovePicker } from "./MovePicker.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Tray } from "./Tray.tsx";
import { useBoard } from "./useBoard.ts";
import { useSearch, weekOf } from "./board-view.ts";
import { ChangePanel, changedNotice } from "./ChangePanel.tsx";
import { NoticeLine } from "./NoticeLine.tsx";
import { useOver, type Over } from "./over.ts";
import { OpenedDrawer } from "./OpenedDrawer.tsx";
import { DayRoutes } from "./DayRoutes.tsx";
import { isBlackout, kmFrom, landsAtFrom, windowsFrom } from "./rooms.ts";
import { useAskedVisit, useClientCalls } from "./useBoardCalls.ts";
import { useMove, type Move } from "./useMove.ts";

type Moving = ReturnType<typeof useMove>;

/** What stands over the board: a block's drawer, a day's routes, the panel a change opened, and the reason a move asks. */
function BoardOverlays(props: {
  over: Over;
  set: ReturnType<typeof useOver>[1];
  access: ReturnType<typeof useAccess>;
  city: BoardQuery["city"];
  drawer: {
    close: () => void;
    take: (job: Job, clearingCheckIn?: boolean) => void;
    told: (moveId: string, name: string) => Promise<void>;
    withdraw: (proposalId: string, name: string) => Promise<void>;
    restore: () => void;
  };
  onChanged: (done: boolean) => Promise<void>;
  picking: (Move & { to: NonNullable<Move["to"]> }) | null;
  moving: Pick<Moving, "rooms" | "unpick" | "send">;
}) {
  const { over, set, access, city, drawer, onChanged, picking, moving } = props;
  const { opened, changing, routesOn } = over;
  return (
    <>
      {opened !== null && (
        <OpenedDrawer
          opened={opened}
          access={access}
          onClose={drawer.close}
          onTake={drawer.take}
          onTold={(moveId, name) => {
            set.opened(null);
            void drawer.told(moveId, name).then(drawer.restore);
          }}
          onWithdraw={(proposalId, name) => {
            set.opened(null);
            void drawer.withdraw(proposalId, name).then(drawer.restore);
          }}
          onChange={set.changing}
        />
      )}
      {routesOn !== null && (
        <DayRoutes
          date={routesOn}
          city={city}
          onClose={() => {
            set.routesOn(null);
          }}
        />
      )}
      {changing !== null && <ChangePanel changing={changing} onClose={(done) => void onChanged(done)} />}
      {picking !== null && (
        <MovePicker
          job={picking.job}
          onCancel={moving.unpick}
          onSend={(reason, blackoutReason, asking) => {
            moving.send({ reason, blackoutReason, asking });
          }}
          sending={picking.sending}
          clearingCheckIn={picking.clearingCheckIn}
          to={picking.to}
          landsAt={landsAtFrom(moving.rooms, picking.to)}
          blackout={isBlackout(moving.rooms, picking.to.date)}
        />
      )}
    </>
  );
}

export function DispatchScreen() {
  const [asked] = useState(() => dispatchAsked(window.location.search));
  const [query, setQuery] = useState<BoardQuery>({ from: asked.from, city: asked.city });
  const [find, setFind] = useState(asked.find);
  const [over, set] = useOver();
  const { opened, changing, notice } = over;
  const [move, setMove] = useState<Move | null>(null);
  const { loaded, last, refresh, retry } = useBoard(query, move !== null || opened !== null || changing !== null);
  const board = loaded.state === "loaded" ? loaded.value : null;
  useHeaderSub(board === null ? undefined : weekOf(board.dates));
  const access = useAccess();
  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  const opener = useRef<HTMLElement | null>(null);
  const area = useRef<HTMLDivElement>(null);

  useAddressKeeps(query, find, opened === null ? null : idOf(opened));
  useAskedVisit({ board, visit: asked.visit, area, opener, setOpened: set.opened, setNotice: set.notice });
  const { told, withdraw } = useClientCalls(refresh, set.notice);

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
    setNotice: set.notice,
    setOpened: set.opened,
    opener,
    area,
    restore,
  });

  const open = useCallback(
    (job: Job, from: HTMLElement) => {
      opener.current = from;
      set.notice(null);
      set.opened(job);
    },
    [set],
  );

  const closeDrawer = useCallback(() => {
    set.opened(null);
    restore();
  }, [restore, set]);

  /** The panel closed: a visit cancelled or closed leaves the board as it was read, so it is read again. */
  const changed = async (done: boolean) => {
    const was = changing;
    set.changing(null);
    if (!done || was === null) {
      restore();
      return;
    }
    opener.current = null;
    set.notice(changedNotice(was));
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
                  onRoutes={access.mayCall("GET /api/dispatch/day") ? set.routesOn : null}
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

      <BoardOverlays
        over={over}
        set={set}
        access={access}
        city={query.city}
        drawer={{
          close: closeDrawer,
          take: (job, clearingCheckIn) => {
            take(job, opener.current, clearingCheckIn);
          },
          told,
          withdraw,
          restore,
        }}
        onChanged={changed}
        picking={picking}
        moving={{ rooms, unpick, send }}
      />
    </>
  );
}
