// What Settings › Areas (./Served.tsx) works out, apart from how it draws it: what a change moves, what it would
// launch or the API refuse, and a file's changes before they are saved.

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

/** The chosen pincodes served, or none of them. */
export const chosenServed = (pincodes: readonly ServedPincode[], chosen: ReadonlySet<string>, served: boolean): Draft =>
  Object.fromEntries(
    pincodes.filter((each) => chosen.has(each.pincode)).map((each) => [each.pincode, { ...rowOf(each), served }]),
  );

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

/** What a file would change: pincodes we do not hold, and lines that change nothing, are left out. */
export function fileChanges(pincodes: readonly ServedPincode[], lines: readonly CsvRow[]): FileChange[] {
  const held = new Map(pincodes.map((each) => [each.pincode, each]));
  const rows: FileChange[] = [];
  for (const line of lines) {
    const pincode = held.get(line.pincode);
    if (pincode === undefined) continue;
    const now = rowOf(pincode);
    const file = { ...now, served: line.served, launch_on: line.launch_on };
    if (!sameRow(file, now)) rows.push({ pincode, now, file });
  }
  return rows;
}

/** The file's pincodes we do not hold, each with a city: added from India Post's list before their changes are read. */
function fileAdds(pincodes: readonly ServedPincode[], lines: readonly CsvRow[]): CsvRow[] {
  const held = new Set(pincodes.map((each) => each.pincode));
  return lines.filter((line) => !held.has(line.pincode) && line.city !== "");
}

/** A file read: its changes, and first the pincodes it would add; or why it cannot be read. `said`: how an add went. */
export type Upload =
  | {
      readonly step: "read";
      readonly lines: readonly CsvRow[];
      readonly rows: readonly FileChange[];
      readonly adds: readonly CsvRow[];
      readonly said: string | null;
    }
  | { readonly step: "failed"; readonly says: string };

/** A file's lines read against the pincodes we hold. */
export const readUpload = (
  pincodes: readonly ServedPincode[],
  lines: readonly CsvRow[],
): Extract<Upload, { step: "read" }> => ({
  step: "read",
  lines,
  rows: fileChanges(pincodes, lines),
  adds: fileAdds(pincodes, lines),
  said: null,
});

/** The file's changes as one draft, which is saved whole. */
export const fileDraft = (rows: readonly FileChange[]): Draft =>
  Object.fromEntries(rows.map((row) => [row.pincode.pincode, row.file]));

/** What a file read says, as the upload's line. */
export function uploadRefusal(read: Extract<CsvRead, { ok: false }>): string {
  if (read.reason === "header") return areas.served.upload.badHeader;
  if (read.reason === "served") return areas.served.upload.badServed(read.pincode);
  return areas.served.upload.badDate(read.pincode);
}
