// A photograph's link lasts 15 minutes (src/routes/client/photos.ts). A page of photographs reads its links again
// before they run out, when it comes back into view, and once when an image will not load, so a page left open shows
// fresh links rather than blank boxes.

import { useMemo, useRef } from "react";

/** How often a page of photographs reads its links again while it is in view: well inside their 15 minutes. */
export const LINKS_FRESH_MS = 10 * 60_000;

/** An image that will not load reads the links again once in this long at most, so a store that is down is not asked in a loop. */
const AGAIN_AFTER_MS = 60_000;

/** What a photograph that did not load does: `failed` has the page read fresh links, `reload` is the person's tap. */
export interface Relink {
  readonly failed: () => void;
  readonly reload: () => void;
}

export function useRelink(refresh: () => void): Relink {
  const last = useRef(0);
  return useMemo(
    () => ({
      failed: () => {
        if (Date.now() - last.current < AGAIN_AFTER_MS) return;
        last.current = Date.now();
        refresh();
      },
      reload: () => {
        last.current = Date.now();
        refresh();
      },
    }),
    [refresh],
  );
}
