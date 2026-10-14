// Hair systems counted by their labels (docs/decisions/0185-cycle-counts.md): what a place holds under labels is
// counted by scanning each label there. A label held there and not scanned goes missing by name, not the oldest piece
// in line, and a label scanned that the place does not hold is flagged for ops.

import type { Place } from "./stock-places.ts";
import { z } from "zod";
import { storedJson } from "../../lib/stored-json.ts";

/** What a count's labels found against the place: those held and not scanned, and those scanned and not held. */
export interface LabelsFound {
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

/** The labels each code is held under at a place, for the codes given. */
export async function labelsHeld(
  db: D1Database,
  place: Place,
  codes: readonly string[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const { results } = await db
    .prepare(
      `SELECT consumable_code, code FROM stock_units INDEXED BY stock_units_held
       WHERE place = ?1 AND state = 'held' AND consumable_code IN (SELECT value FROM json_each(?2))`,
    )
    .bind(place, JSON.stringify(codes))
    .all<{ consumable_code: string; code: string }>();
  const held = new Map<string, Set<string>>();
  for (const row of results) held.set(row.consumable_code, (held.get(row.consumable_code) ?? new Set()).add(row.code));
  return held;
}

/** The labels scanned held up against those the place holds. */
export function labelsFound(held: ReadonlySet<string> | undefined, scanned: readonly string[]): LabelsFound {
  const there = held ?? new Set<string>();
  const seen = new Set(scanned);
  return {
    missing: [...there].filter((label) => !seen.has(label)).sort(),
    unknown: scanned.filter((label) => !there.has(label)),
  };
}

/** A line as counted: the figure, with the labels scanned where the place holds the item under labels. */
export interface CountedLine {
  readonly code: string;
  readonly counted: number;
  readonly labels?: readonly string[] | undefined;
}

/**
 * The fields wrong in a count's lines: a line of an item the place holds under labels needs them, each once, and its
 * figure counts every one scanned, with any pieces there that carry none.
 */
export function labelFields(lines: readonly CountedLine[], held: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return lines.flatMap((line, index) => {
    const at = `lines.${String(index)}`;
    if (line.labels === undefined) return held.has(line.code) ? [`${at}.labels`] : [];
    if (new Set(line.labels).size !== line.labels.length) return [`${at}.labels`];
    return line.counted < line.labels.length ? [`${at}.counted`] : [];
  });
}

/** A line's labels as count_lines keeps them: JSON arrays, or NULL on a line counted by number. */
export function labelColumns(line: CountedLine, found: LabelsFound | null) {
  if (line.labels === undefined || found === null) return { labels: null, missing: null, unknown: null };
  return {
    labels: JSON.stringify(line.labels),
    missing: JSON.stringify(found.missing),
    unknown: JSON.stringify(found.unknown),
  };
}

/** Labels kept as JSON, or none. */
export const labelsOf = (kept: string | null): string[] =>
  kept === null ? [] : storedJson(z.array(z.string()), kept, "count_lines labels");
