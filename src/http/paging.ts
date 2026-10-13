// The one way a list is paged (docs/api-style.md): the caller asks for the next page with `cursor`, as the last page's
// `next_cursor` gave it, and each page answers the next page's cursor, or null on the last. A cursor is opaque to the
// caller: inside, it is where the next page starts, in whatever terms the list keeps its order.

import { z } from "@hono/zod-openapi";

const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

/** A paged list's `cursor` query: the next page, or the first when left out. */
export const CursorQuery = z
  .string()
  .regex(CURSOR)
  .optional()
  .openapi({ description: "The next page: `next_cursor` from the last one. Left out, the first." });

/** A page's `next_cursor`: asked as `cursor`, the next page; null on the last. */
export const NextCursor = z
  .union([z.string(), z.null()])
  .openapi({ description: "Asked as `cursor`, the next page; null on the last." });

/** Where a list's next page starts, as the cursor the caller asks it by. */
export const cursorOf = (place: string): string =>
  btoa(place).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The place a cursor names; null for one this server could not have given. */
export function placeOf(cursor: string): string | null {
  try {
    return atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

/** A place that is a count from the list's start (a page, or rows to skip); null for any other. */
export function countOf(cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  const place = placeOf(cursor);
  return place !== null && /^\d{1,6}$/.test(place) ? Number(place) : null;
}

/**
 * A capped list's `more`: the list stops at its first `cap`, the oldest or most pressing first, and says when there
 * were more. A list that may grow past its cap for good is paged instead.
 */
export const More = (cap: number) =>
  z.boolean().openapi({ description: `More than ${String(cap)} match: these are the first ${String(cap)}.` });

/** The first `cap` of rows read as one more than the cap, and whether there were more. */
export const capped = <T>(rows: readonly T[], cap: number): { readonly rows: T[]; readonly more: boolean } => ({
  rows: rows.slice(0, cap),
  more: rows.length > cap,
});
