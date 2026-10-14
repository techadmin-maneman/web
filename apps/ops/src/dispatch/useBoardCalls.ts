// What the dispatch board does beyond moving a job (./DispatchScreen.tsx): the visit a link asked for brought into
// view, a client called about a move they had not heard of, and a move to another day taken back.

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { api, type Board } from "../api.ts";
import { dispatch } from "../content.ts";
import { blockOn, type Job } from "./job.ts";
import type { Notice } from "./landing.ts";

interface Shown {
  readonly board: Board | null;
  /** The visit a link asked for ("?visit=…"), until the first board read shows it. */
  readonly visit: string | null;
  readonly area: RefObject<HTMLDivElement | null>;
  readonly opener: { current: HTMLElement | null };
  readonly setOpened: (job: Job | null) => void;
  readonly setNotice: (notice: Notice | null) => void;
}

/** Brings the visit a link asked for into view: its block with its drawer open, or its place in the tray. */
export function useAskedVisit({ board, visit, area, opener, setOpened, setNotice }: Shown): void {
  const asked = useRef(visit);

  /** Its block, with its drawer open, or its place in the tray; else says it is not here. */
  const showVisit = useCallback(
    (on: Board, wanted: string) => {
      const element = area.current?.querySelector<HTMLElement>(`[data-appointment="${wanted}"]`) ?? null;
      element?.scrollIntoView({ block: "center", inline: "nearest" });
      // The keyboard goes to the visit first, so the browser gives it back there when the drawer closes.
      element?.focus();
      const job = blockOn(on, wanted);
      if (job !== null) {
        opener.current = element;
        setOpened(job);
        return;
      }
      const inTray = on.unassigned.find((each) => each.appointment_id === wanted);
      if (inTray === undefined) {
        setNotice({ tone: "refusal", text: dispatch.landing.notOnBoard, call: null });
        return;
      }
      opener.current = element;
      setOpened({ kind: "unassigned", job: inTray });
    },
    [area, opener, setNotice, setOpened],
  );

  useEffect(() => {
    const wanted = asked.current;
    if (board === null || wanted === null) return;
    asked.current = null;
    showVisit(board, wanted);
  }, [board, showVisit]);
}

/** Ops called a client who had not heard of a move, or took back a move the client was asked to confirm. */
export function useClientCalls(refresh: () => Promise<Board | null>, setNotice: (notice: Notice | null) => void) {
  /** Its task leaves the Tasks board. */
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
    [refresh, setNotice],
  );

  /** The visit stays where it is. */
  const withdraw = useCallback(
    async (proposalId: string, name: string) => {
      const answer = await api.withdrawProposal(proposalId);
      setNotice(
        answer.ok
          ? { tone: "done", text: dispatch.landing.withdrawn(name), call: null }
          : { tone: "refusal", text: dispatch.landing.withdrawFailed, call: null },
      );
      await refresh();
    },
    [refresh, setNotice],
  );

  return { told, withdraw };
}
