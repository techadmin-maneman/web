// A queue row named in the address, as "/no-shows#case-…": the Tasks board
// links each task to the row it is decided on. Once the queue has loaded, the
// row is scrolled to and given the keyboard, so ops land on the thing to do.

import { useEffect, useState } from "react";

/** The id of a queue row, as its element carries it and a link names it. */
export const rowId = (kind: string, id: string): string => `${kind}-${id}`;

/** A path to one row of a queue: "/no-shows#case-…". */
export const rowPath = (page: string, kind: string, id: string): string => `${page}#${rowId(kind, id)}`;

/**
 * Once `ready`, brings the row the address names into view and focuses it; answers its id, or null. A target taller
 * than the screen, such as a section of Settings, is brought in at its top.
 */
export function useTargetRow(ready: boolean, block: ScrollLogicalPosition = "center"): string | null {
  const [target] = useState(() => {
    const named = decodeURIComponent(window.location.hash.slice(1));
    return named === "" ? null : named;
  });
  useEffect(() => {
    if (!ready || target === null) return;
    const row = document.getElementById(target);
    row?.scrollIntoView({ block });
    row?.focus();
  }, [ready, target, block]);
  return target;
}
