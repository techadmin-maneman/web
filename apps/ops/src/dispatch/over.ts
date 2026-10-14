// What stands over the dispatch board (./DispatchScreen.tsx): the drawer a block opened, the panel a change to its
// visit opened, a day's routes, and the line the last action left. A change replaces the drawer it was asked from.

import { useMemo, useReducer } from "react";
import type { Changing } from "./ChangePanel.tsx";
import type { Job } from "./job.ts";
import type { Notice } from "./landing.ts";

export interface Over {
  readonly opened: Job | null;
  readonly changing: Changing | null;
  readonly routesOn: string | null;
  readonly notice: Notice | null;
}

type Step =
  | { readonly kind: "open"; readonly job: Job | null }
  | { readonly kind: "change"; readonly changing: Changing | null }
  | { readonly kind: "routes"; readonly date: string | null }
  | { readonly kind: "notice"; readonly notice: Notice | null };

const NOTHING: Over = { opened: null, changing: null, routesOn: null, notice: null };

function next(over: Over, step: Step): Over {
  switch (step.kind) {
    case "open":
      return { ...over, opened: step.job };
    case "change":
      // The panel takes the drawer's place, and the line the board said before it goes.
      return step.changing === null
        ? { ...over, changing: null }
        : { ...over, opened: null, notice: null, changing: step.changing };
    case "routes":
      return { ...over, routesOn: step.date };
    case "notice":
      return { ...over, notice: step.notice };
  }
}

/** What stands over the board, and a setter for each part of it, each the same from one draw to the next. */
export function useOver() {
  const [over, dispatch] = useReducer(next, NOTHING);
  const set = useMemo(
    () => ({
      opened: (job: Job | null) => {
        dispatch({ kind: "open", job });
      },
      changing: (changing: Changing | null) => {
        dispatch({ kind: "change", changing });
      },
      routesOn: (date: string | null) => {
        dispatch({ kind: "routes", date });
      },
      notice: (notice: Notice | null) => {
        dispatch({ kind: "notice", notice });
      },
    }),
    [],
  );
  return [over, set] as const;
}
