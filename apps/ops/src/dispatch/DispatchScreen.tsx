// The dispatch board: active technicians down, and their day along the hours (./DayBoard.tsx), which it opens on, or
// seven days across; and the jobs nobody holds in a tray (src/policy/dispatch.ts). A job is moved from its drawer: the board lists only the technicians' days it would land on,
// the sheet its starts there and a reason, and the server checks again (docs/decisions/0034-clash-check.md,
// 0069-dispatch-under-concurrency.md). The address keeps the week, city, search and visit (./address.ts).

import { EmptyState } from "@maneman/ui/EmptyState";
import { indiaDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Board, BoardQuery, BoardRow } from "../api.ts";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { dispatch } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { useAddressKeeps } from "./address.ts";
import styles from "./dispatch-screen.module.css";
import { Grid } from "./Grid.tsx";
import { dispatchAsked } from "../route.ts";
import { idOf, type Job, type Target } from "./job.ts";
import { MoveBar, type InHand } from "./MoveBar.tsx";
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
import { BoardControls } from "./BoardControls.tsx";
import { PhoneDay } from "./PhoneDay.tsx";
import { useIsPhone } from "../lib/media.ts";
import { DayBoard, firstView, shownDay, type BoardView } from "./DayBoard.tsx";
import { isBlackout, kmFrom, startsFrom, daysFrom } from "./rooms.ts";
import { useAskedVisit, useClientCalls } from "./useBoardCalls.ts";
import { useMove, type Move } from "./useMove.ts";
import { apiNow } from "@maneman/web-kit/clock";

type Moving = ReturnType<typeof useMove>;

/** What stands over the board: a block's drawer, a day's routes, the panel a change opened, and the reason a move asks. */
function BoardOverlays(props: {
  over: Over;
  set: ReturnType<typeof useOver>[1];
  access: ReturnType<typeof useAccess>;
  city: BoardQuery["city"];
  technicians: readonly BoardRow[];
  drawer: {
    close: () => void;
    take: (job: Job, clearingCheckIn?: boolean) => void;
    assign: (job: Job, to: Target) => void;
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
          onAssignTo={drawer.assign}
          technicians={props.technicians}
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
          onSend={(sent) => {
            moving.send(sent);
          }}
          sending={picking.sending}
          clearingCheckIn={picking.clearingCheckIn}
          to={picking.to}
          starts={startsFrom(moving.rooms, picking.to)}
          blackout={isBlackout(moving.rooms, picking.to.date)}
        />
      )}
    </>
  );
}

/** The day's line beside the title: its visits, the technicians working, and the visits nobody is on. */
function daySub(board: Board, date: string): string {
  const blocks = board.technicians.map((row) => row.days.find((day) => day.date === date)?.blocks ?? []);
  const nobody = board.unassigned.filter((job) => (job.date ?? indiaDate(job.starts_at)) === date).length;
  const visits = blocks.reduce((sum, each) => sum + each.length, 0);
  return dispatch.day.sub(visits, blocks.filter((each) => each.length > 0).length, nobody);
}

/** The board itself, by the day or the week, the head's controls at its right; what the search keeps of it, or why none. */
function BoardBody(props: {
  board: Board;
  search: ReturnType<typeof useSearch>;
  view: BoardView;
  onView: (view: BoardView) => void;
  onWeek: (from: string | null) => void;
  inHand: InHand | null;
  onOpen: (job: Job, from: HTMLElement) => void;
  onLand: (to: Target) => void;
  onRoutes: ((date: string) => void) | null;
}) {
  const { board, search, view, inHand, onOpen, onLand } = props;
  const phone = useIsPhone();
  const [day, setDay] = useState<string | null>(null);
  const today = todayInIndia(apiNow());
  const dayShown = shownDay(board.dates, day, today);
  const { rows } = search;
  useHeaderSub(view === "day" && dayShown !== undefined ? daySub(board, dayShown) : weekOf(board.dates));
  return (
    <>
      <PageActions>
        <BoardControls
          view={view}
          onView={props.onView}
          day={dayShown}
          dates={board.dates}
          today={today}
          onDay={setDay}
          onWeek={props.onWeek}
        />
      </PageActions>
      {phone && rows.length > 0 && view === "day" && dayShown !== undefined ? (
        <PhoneDay board={board} rows={rows} date={dayShown} now={apiNow()} onOpen={onOpen} />
      ) : (
        <div className={styles.scroll}>
          {board.technicians.length === 0 && <EmptyState look="panel" line={dispatch.board.empty} />}
          {board.technicians.length > 0 && rows.length === 0 && (
            <EmptyState look="panel" line={dispatch.tools.nothingFound(search.settled.trim())} />
          )}
          {!phone && rows.length > 0 && view === "day" && dayShown !== undefined && (
            <DayBoard
              board={board}
              rows={rows}
              date={dayShown}
              inHand={inHand}
              now={apiNow()}
              onOpen={onOpen}
              onLand={onLand}
            />
          )}
          {rows.length > 0 && view === "week" && (
            <Grid board={board} rows={rows} found={search.found} onOpen={onOpen} onRoutes={props.onRoutes} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * The week and the visit the board was asked for, for the city chosen in the header (ADR 0225), whatever an older
 * link's address names.
 */
function useBoardQuery(asked: { from: string | null; visit: string | null }) {
  const [query, setQuery] = useState<BoardQuery>({ from: asked.from, city: null, visit: asked.visit });
  const { city } = useCity();
  const withCity = useMemo(() => ({ ...query, city }), [query, city]);
  return [withCity, setQuery] as const;
}

/** The drawer's ways into a move: taking its job up to place, and putting a tray job on a technician chosen. */
function drawerMoves(
  take: (job: Job, from: HTMLElement | null, clearingCheckIn?: boolean) => void,
  land: (to: Target) => void,
  opener: { readonly current: HTMLElement | null },
) {
  return {
    take: (job: Job, clearingCheckIn?: boolean) => {
      take(job, opener.current, clearingCheckIn);
    },
    assign: (job: Job, to: Target) => {
      take(job, opener.current, false);
      land(to);
    },
  };
}

/** What the address asked of the board, and what is asked of it since: the week, the search, Day or Week. */
function useAsked() {
  const [asked] = useState(() => dispatchAsked(window.location.search));
  const [query, setQuery] = useBoardQuery(asked);
  const [find, setFind] = useState(asked.find);
  const [view, setView] = useState<BoardView>(() => firstView(asked));
  const onWeek = (from: string | null) => {
    setQuery({ ...query, from });
  };
  return { asked, query, setQuery, onWeek, find, setFind, view, setView };
}

export function DispatchScreen() {
  const { asked, query, onWeek, find, setFind, view, setView } = useAsked();
  const [over, set] = useOver();
  const { opened, changing, notice } = over;
  const [move, setMove] = useState<Move | null>(null);
  const { loaded, refresh, retry } = useBoard(query, move !== null || opened !== null || changing !== null);
  const board = loaded.state === "loaded" ? loaded.value : null;
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
      choosing && move !== null ? { job: move.job, startsAt: daysFrom(rooms), kmAt: kmFrom(rooms) } : null,
    [choosing, move, rooms],
  );
  const chosen = move?.to ?? null;
  const picking = move === null || chosen === null ? null : { ...move, to: chosen };

  return (
    <>
      <div className={styles.area} ref={area} tabIndex={-1}>
        <div className={styles.main}>
          <Toolbar day={view === "day"} find={find} onFind={setFind} />
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
          {loaded.state === "loading" && <PanelLoading />}
          {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
          {board !== null && (
            <BoardBody
              board={board}
              search={{ settled, rows, found }}
              view={view}
              onView={setView}
              onWeek={onWeek}
              inHand={inHand}
              onOpen={open}
              onLand={land}
              onRoutes={access.mayCall("GET /api/dispatch/day") ? set.routesOn : null}
            />
          )}
          {board !== null && <Tray unassigned={board.unassigned} onOpen={open} />}
        </div>
      </div>

      <BoardOverlays
        over={over}
        set={set}
        access={access}
        city={query.city}
        technicians={board?.technicians ?? []}
        drawer={{
          close: closeDrawer,
          ...drawerMoves(take, land, opener),
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
