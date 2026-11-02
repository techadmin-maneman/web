// What a page tells the head the frame draws above it (./Shell.tsx), for as long as the page is open: figures beside
// the title or the day above it, a record's own name or a sentence on the day as the title, a record's badges and
// facts, and its actions.

import type { BadgeTone } from "@maneman/ui/Badge";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A record's badges beside its name and its facts beneath, as a client's page heads itself. */
export interface RecordHead {
  readonly badges: readonly { readonly words: string; readonly tone: BadgeTone }[];
  readonly facts: readonly string[];
}

interface Head {
  readonly setSub: (sub: string | undefined) => void;
  readonly setOver: (over: string | undefined) => void;
  readonly setRecord: (name: string | undefined) => void;
  readonly setHeading: (heading: string | undefined) => void;
  readonly setRecordHead: (head: RecordHead | undefined) => void;
  /** Where the page's actions are drawn; null until the head is. */
  readonly actions: HTMLElement | null;
  /** Where a record's column of facts is drawn, beside its head and all beneath it; null until the frame is. */
  readonly aside: HTMLElement | null;
}

export const PageHead = createContext<Head>({
  setSub: () => undefined,
  setOver: () => undefined,
  setRecord: () => undefined,
  setHeading: () => undefined,
  setRecordHead: () => undefined,
  actions: null,
  aside: null,
});

/** Tells the head a value of the page's for as long as the page is open with it. */
function useHeadValue<T>(set: (value: T | undefined) => void, value: T | undefined): void {
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

/**
 * A record's badges and facts in its head, beside and beneath its name (useRecordTitle), its initials before it. The
 * page keeps the same object while they stand, as a new one draws the head again.
 */
export function useRecordHead(head: RecordHead | undefined): void {
  useHeadValue(useContext(PageHead).setRecordHead, head);
}

/** The page's own actions, drawn at the right of its head. */
export function PageActions({ children }: { readonly children: ReactNode }) {
  const { actions } = useContext(PageHead);
  return actions === null ? null : createPortal(children, actions);
}

/**
 * A record's column of facts, at the page's right from its head down, as a client's page sets its figures, address and
 * notes beside it; beneath the page short of a desk's width.
 */
export function PageAside({ children }: { readonly children: ReactNode }) {
  const { aside } = useContext(PageHead);
  return aside === null ? null : createPortal(children, aside);
}
