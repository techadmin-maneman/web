// The board's place in the address: the week, the city, the search, and the visit whose drawer is open. A link opens
// the board there, and Back from a client's page finds it as it was left.

import { useEffect } from "react";
import type { BoardQuery } from "../api.ts";
import { dispatchPath } from "../route.ts";

/** Writes the board's place into the address as it changes, in place of the entry there, so Back takes no extra step. */
export function useAddressKeeps(query: BoardQuery, find: string, visit: string | null): void {
  const { from, city } = query;
  useEffect(() => {
    const path = dispatchPath({ from, city, find, visit });
    if (path === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", path);
  }, [from, city, find, visit]);
}
