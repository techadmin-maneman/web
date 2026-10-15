// What a page tells the head the frame draws above it (./Shell.tsx), for as long as the page is open: figures beside
// the title, a record's own name as the title, and the page's actions at its right.

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Head {
  readonly setSub: (sub: string | undefined) => void;
  readonly setRecord: (name: string | undefined) => void;
  /** Where the page's actions are drawn; null until the head is. */
  readonly actions: HTMLElement | null;
}

export const PageHead = createContext<Head>({ setSub: () => undefined, setRecord: () => undefined, actions: null });

/** A line of figures beside the title, as the dispatch board puts its week there. */
export function useHeaderSub(sub: string | undefined): void {
  const { setSub } = useContext(PageHead);
  useEffect(() => {
    setSub(sub);
    return () => {
      setSub(undefined);
    };
  }, [setSub, sub]);
}

/** A record's own name as the page's title, its section a step above it: a client's, a technician's. */
export function useRecordTitle(name: string | undefined): void {
  const { setRecord } = useContext(PageHead);
  useEffect(() => {
    setRecord(name);
    return () => {
      setRecord(undefined);
    };
  }, [setRecord, name]);
}

/** The page's own actions, drawn at the right of its head. */
export function PageActions({ children }: { readonly children: ReactNode }) {
  const { actions } = useContext(PageHead);
  return actions === null ? null : createPortal(children, actions);
}
