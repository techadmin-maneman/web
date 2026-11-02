// What a page tells the head the frame draws above it (./Shell.tsx), for as long as the page is open: figures beside
// the title or the day above it, a record's own name or a sentence on the day as the title, and its actions.

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Head {
  readonly setSub: (sub: string | undefined) => void;
  readonly setOver: (over: string | undefined) => void;
  readonly setRecord: (name: string | undefined) => void;
  readonly setHeading: (heading: string | undefined) => void;
  /** Where the page's actions are drawn; null until the head is. */
  readonly actions: HTMLElement | null;
}

export const PageHead = createContext<Head>({
  setSub: () => undefined,
  setOver: () => undefined,
  setRecord: () => undefined,
  setHeading: () => undefined,
  actions: null,
});

/** Tells the head a value of the page's for as long as the page is open with it. */
function useHeadValue(set: (value: string | undefined) => void, value: string | undefined): void {
  useEffect(() => {
    set(value);
    return () => {
      set(undefined);
    };
  }, [set, value]);
}

/** A line of figures beside the title, as the dispatch board puts its week there. */
export function useHeaderSub(sub: string | undefined): void {
  useHeadValue(useContext(PageHead).setSub, sub);
}

/** The day and the place, on a small line above a title that is a sentence on them: Today's. */
export function useHeaderOver(over: string | undefined): void {
  useHeadValue(useContext(PageHead).setOver, over);
}

/**
 * A sentence on the day in place of the page's title, as Today heads itself; where the page sits, and the window's
 * title, still name the page.
 */
export function useHeading(heading: string | undefined): void {
  useHeadValue(useContext(PageHead).setHeading, heading);
}

/** A record's own name as the page's title, its section a step above it: a client's, a technician's. */
export function useRecordTitle(name: string | undefined): void {
  useHeadValue(useContext(PageHead).setRecord, name);
}

/** The page's own actions, drawn at the right of its head. */
export function PageActions({ children }: { readonly children: ReactNode }) {
  const { actions } = useContext(PageHead);
  return actions === null ? null : createPortal(children, actions);
}
