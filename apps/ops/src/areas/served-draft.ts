// What the Served tab (./Served.tsx) works out, apart from how it draws it: the table as ops have it, what has moved
// since it loaded, what a save would launch or the API refuse, and a file's changes before they go into the table.

import type { AreaChange, ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import type { CsvRead, CsvRow } from "./csv.ts";

/** What ops set for one pincode: the two columns that are theirs, and the area's name as they have typed it. */
export interface Row {
  readonly served: boolean;
  readonly launch_on: string | null;
  readonly area: string;
}

export type Draft = Readonly<Record<string, Row>>;

/** One pincode the file would change: what the table shows now, and what the file says. */
export interface FileChange {
  readonly pincode: ServedPincode;
  readonly now: Row;
  readonly file: Row;
}

export const rowOf = (pincode: ServedPincode): Row => ({
  served: pincode.served,
  launch_on: pincode.launch_on,
  area: pincode.area,
});

export const draftOf = (pincodes: readonly ServedPincode[]): Draft =>
  Object.fromEntries(pincodes.map((each) => [each.pincode, rowOf(each)]));

const sameRow = (a: Row, b: Row) => a.served === b.served && a.launch_on === b.launch_on && a.area === b.area;

/** Only what has actually moved: the rest is not sent, so the audit log records no change that was not one. */
export function changesIn(pincodes: readonly ServedPincode[], draft: Draft): AreaChange[] {
  const changes: AreaChange[] = [];
  for (const each of pincodes) {
    const row = draft[each.pincode];
    if (row === undefined) continue;
    const area = row.area.trim();
    if (sameRow({ ...row, area }, rowOf(each))) continue;
    changes.push({
      pincode: each.pincode,
      served: row.served,
      launch_on: row.launch_on,
      ...(area === each.area ? {} : { area }),
    });
  }
  return changes;
}

/** The pincodes a save would begin serving, where somebody waits to be told. */
export function launchesIn(pincodes: readonly ServedPincode[], changes: readonly AreaChange[]): ServedPincode[] {
  return pincodes.filter((each) => {
    const change = changes.find((one) => one.pincode === each.pincode);
    return change !== undefined && change.served && !each.served && each.to_alert > 0;
  });
}

/** A change that would serve a pincode from a day still to come, which the API refuses. */
export function servesLater(pincodes: readonly ServedPincode[], change: AreaChange, today: string): boolean {
  if (!change.served || change.launch_on === null || change.launch_on <= today) return false;
  const held = pincodes.find((each) => each.pincode === change.pincode);
  if (held === undefined) return true;
  return held.served !== change.served || held.launch_on !== change.launch_on;
}

/** Every pincode of a city served, or none: the bulk pair. */
export function withCity(draft: Draft, inCity: readonly ServedPincode[], served: boolean): Draft {
  const next: Record<string, Row> = { ...draft };
  for (const each of inCity) next[each.pincode] = { ...(next[each.pincode] ?? rowOf(each)), served };
  return next;
}

/** The pincodes as they stand once a save is made: whoever waited where one launched has been told. */
export function afterSave(held: readonly ServedPincode[], changes: readonly AreaChange[]): ServedPincode[] {
  return held.map((each) => {
    const change = changes.find((one) => one.pincode === each.pincode);
    if (change === undefined) return each;
    const launched = change.served && !each.served;
    return {
      ...each,
      served: change.served,
      launch_on: change.launch_on,
      area: change.area ?? each.area,
      to_alert: launched ? 0 : each.to_alert,
    };
  });
}

/** What a file would change in the table: pincodes we do not hold, and lines that change nothing, are left out. */
export function fileChanges(pincodes: readonly ServedPincode[], draft: Draft, lines: readonly CsvRow[]): FileChange[] {
  const held = new Map(pincodes.map((each) => [each.pincode, each]));
  const rows: FileChange[] = [];
  for (const line of lines) {
    const pincode = held.get(line.pincode);
    const now = draft[line.pincode];
    if (pincode === undefined || now === undefined) continue;
    const file = { ...now, served: line.served, launch_on: line.launch_on };
    if (!sameRow(file, now)) rows.push({ pincode, now, file });
  }
  return rows;
}

/** The file's changes put into the draft, where the table shows them and the one Save sends them. */
export function withFile(draft: Draft, rows: readonly FileChange[]): Draft {
  const next: Record<string, Row> = { ...draft };
  for (const row of rows) next[row.pincode.pincode] = row.file;
  return next;
}

/** What a file read says, as the upload's line. */
export function uploadRefusal(read: Extract<CsvRead, { ok: false }>): string {
  if (read.reason === "header") return areas.served.upload.badHeader;
  if (read.reason === "served") return areas.served.upload.badServed(read.pincode);
  return areas.served.upload.badDate(read.pincode);
}
