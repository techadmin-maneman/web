// The job in hand on the dispatch board (./DispatchScreen.tsx): taken up, landed on a window, and sent with a reason.
// The board first asks where the job would land, and offers only those windows; the server checks again before
// anything is written (docs/decisions/0034-clash-check.md), and a move from a board gone stale is refused
// (docs/decisions/0069-dispatch-under-concurrency.md).

import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { type Board, type Landing, type MoveReason } from "../api.ts";
import { idOf, shownOf, type Job, type Target } from "./job.ts";
import { askedNotice, doneNotice, moveRefusal, STALE, staleWords, type Notice } from "./landing.ts";
import { useRooms } from "./rooms.ts";
import { dispatchApi } from "./dispatch-api.ts";

/**
 * A move in hand: the job, the window chosen for it, whether it is being sent, and whether ops chose, after the
 * drawer's warning, to clear the technician's check-in.
 */
export interface Move {
  readonly job: Job;
  readonly to: Target | null;
  readonly sending: boolean;
  readonly clearingCheckIn: boolean;
}

interface OnTheBoard {
  /** The first day of the week on screen; null before the board is read. */
  readonly weekFrom: string | null;
  /** The drawer open on the board, which takes Escape for itself. */
  readonly opened: Job | null;
  readonly refresh: () => Promise<Board | null>;
  readonly setNotice: (notice: Notice | null) => void;
  readonly setOpened: (job: Job | null) => void;
  /** What the drawer or the move was opened from, so the keyboard comes back to it. */
  readonly opener: { current: HTMLElement | null };
  readonly area: RefObject<HTMLDivElement | null>;
  /** The keyboard back to where the drawer or the move was opened from. */
  readonly restore: () => void;
}

/** Why ops move it, and whether a client's visit to another day is asked of them instead. */
interface Sent {
  readonly reason: MoveReason;
  readonly blackoutReason: string | null;
  readonly asking: boolean;
}

/** After the board is read again, the keyboard goes to the block that moved, wherever it now is. */
function focusBlock(area: RefObject<HTMLDivElement | null>, appointmentId: string): void {
  const moved = area.current?.querySelector<HTMLElement>(`[data-appointment="${appointmentId}"]`) ?? null;
  if (moved === null) area.current?.focus();
  else moved.focus();
}

/** Sends the move in hand, and what its answer leads to. */
async function sendMove(
  held: Move & { readonly to: Target },
  sent: Sent,
  on: OnTheBoard & { readonly setMove: (move: Move | null) => void; readonly askRooms: () => void },
): Promise<void> {
  const { job, to } = held;
  on.setMove({ ...held, sending: true });
  const landing: Landing = {
    technicianId: to.technician.technician_id,
    date: to.date,
    window: to.window,
    reason: sent.reason,
    blackoutReason: sent.blackoutReason,
  };
  const shown = shownOf(job);
  // A client's visit to another day, for a reason not theirs, is asked of them; anything else is moved.
  const moved = () =>
    job.kind === "block"
      ? dispatchApi.move(idOf(job), landing, shown, held.clearingCheckIn)
      : dispatchApi.assign(idOf(job), landing, shown);
  const answer = sent.asking ? await dispatchApi.propose(idOf(job), landing, shown) : await moved();

  if (answer.ok) {
    on.setMove(null);
    on.setNotice("proposal_id" in answer.body ? askedNotice(job, to, answer.body) : doneNotice(job, to, answer.body));
    on.opener.current = null;
    await on.refresh();
    focusBlock(on.area, idOf(job));
    return;
  }
  if (STALE.has(answer.code)) {
    // Someone else moved it, or is moving it: the board is read again, and says where it now is.
    on.setMove(null);
    const now = await on.refresh();
    on.setNotice({ tone: "refusal", text: staleWords(job, answer.code, now), call: null });
    on.area.current?.focus();
    return;
  }
  // Nothing was written: the job stays in hand, and the board asks again where it fits.
  on.setMove({ ...held, to: null, sending: false });
  on.setNotice({ tone: "refusal", text: moveRefusal(job, to, answer.code), call: null });
  on.askRooms();
}

/** The job in hand, which the screen keeps, since the board holds off reading itself again while there is one. */
export function useMove([move, setMove]: [Move | null, Dispatch<SetStateAction<Move | null>>], on: OnTheBoard) {
  const bar = useRef<HTMLDivElement>(null);
  const { opener, restore, setNotice, setOpened } = on;
  // Where the job in hand would land in the week on screen, so the board offers only those windows.
  const [rooms, askRooms] = useRooms(move === null ? null : idOf(move.job), on.weekFrom);

  const take = useCallback(
    (job: Job, from: HTMLElement | null, clearingCheckIn = false) => {
      opener.current = from;
      setOpened(null);
      setNotice(null);
      setMove({ job, to: null, sending: false, clearingCheckIn });
      askRooms();
    },
    [askRooms, opener, setMove, setNotice, setOpened],
  );

  /** A job taken up, with no window chosen for it yet. */
  const choosing = move?.to === null;
  // The keyboard follows a job taken up: to the bar that says what is moving and holds the list.
  const taken = choosing && !move.sending;
  useEffect(() => {
    if (taken) bar.current?.focus();
  }, [taken]);

  const land = useCallback(
    (to: Target) => {
      setMove((held) => (held === null || held.sending ? held : { ...held, to }));
    },
    [setMove],
  );

  /** Back to the board with the job still in hand. Not while it is being sent: it could be sent twice. */
  const unpick = useCallback(() => {
    setMove((held) => (held === null || held.sending ? held : { ...held, to: null }));
  }, [setMove]);

  const stop = useCallback(() => {
    if (move?.sending === true) return;
    setMove(null);
    restore();
  }, [move, restore, setMove]);

  const send = (sent: Sent) => {
    const to = move?.to ?? null;
    if (move === null || to === null || move.sending) return;
    void sendMove({ ...move, to }, sent, { ...on, setMove, askRooms });
  };

  // Escape lets go of the move in hand when no panel is open; an open panel closes itself.
  const { opened } = on;
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

  return { rooms, choosing, bar, take, land, unpick, stop, send };
}
