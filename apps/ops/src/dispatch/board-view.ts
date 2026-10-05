// What the dispatch board shows of itself (./DispatchScreen.tsx): the week in its title, and what a search finds,
// the technicians it keeps and the blocks it outlines.

import { shortDate } from "@maneman/web-kit/dates";
import type { Block, Board, BoardRow } from "../api.ts";
import { dispatch } from "../content.ts";

/** "19 to 25 Sep", and "28 Sep to 4 Oct" across a month's end. */
export function weekOf(dates: readonly string[]): string | undefined {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const from = shortDate(first).slice(4);
  const to = shortDate(last).slice(4);
  const sameMonth = from.slice(from.indexOf(" ")) === to.slice(to.indexOf(" "));
  return dispatch.week(sameMonth ? from.slice(0, from.indexOf(" ")) : from, to);
}

const includes = (word: string | null, wanted: string) => word?.toLowerCase().includes(wanted) === true;

/** Whether a block answers to what ops searched for: its client, in short or in full, its area or its pincode. */
const blockAnswersTo = (block: Block, wanted: string): boolean =>
  [block.client, block.person?.name ?? null, block.sector, block.pincode].some((word) => includes(word, wanted));

/** Whether a row answers to what ops searched for: the technician's name or zone, or a visit on one of his days. */
export function answersTo(row: BoardRow, find: string): boolean {
  const wanted = find.trim().toLowerCase();
  if (wanted === "") return true;
  if (includes(row.name, wanted) || includes(row.zone, wanted)) return true;
  return row.days.some((day) => day.blocks.some((block) => blockAnswersTo(block, wanted)));
}

/** The blocks the search found, to outline on the grid; null where it names none, a technician say. */
export function foundBy(board: Board | null, find: string): ((block: Block) => boolean) | null {
  const wanted = find.trim().toLowerCase();
  if (wanted === "" || board === null) return null;
  const any = board.technicians.some((row) =>
    row.days.some((day) => day.blocks.some((b) => blockAnswersTo(b, wanted))),
  );
  return any ? (block) => blockAnswersTo(block, wanted) : null;
}
