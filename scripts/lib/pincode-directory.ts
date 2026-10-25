// India Post's directory of pincodes, as data/pincodes/india-pincodes.csv keeps it (data/pincodes/README.md): read from
// data.gov.in an office at a time, folded into one row a pincode, and written as SQL for pincode_directory.

import { sqlLiteral } from "./sql-literal.ts";
import { fields } from "./pincodes.ts";

/** One post office as the directory lists it. */
export interface Office {
  readonly officename: string;
  readonly pincode: string;
  readonly delivery: string;
  readonly district: string;
  readonly statename: string;
  readonly latitude: string;
  readonly longitude: string;
}

/** One pincode, its delivering office's district, state and point, and every office in it. */
export interface DirectoryPincode {
  readonly pincode: string;
  readonly district: string;
  readonly state: string;
  readonly officeNames: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export const DIRECTORY_COLUMNS = ["pincode", "district", "state", "office_names", "latitude", "longitude"] as const;

const PINCODE = /^[1-9]\d{5}$/;

/** A point inside India, or null: the directory holds blanks, zeros and points in other countries. */
function pointOf(office: Office): readonly [number, number] | null {
  const lat = Number.parseFloat(office.latitude);
  const lng = Number.parseFloat(office.longitude);
  return lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98 ? [lat, lng] : null;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

/** A name as the directory spells it, in one case and with its spaces made single. */
const cleaned = (name: string) => name.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * The directory's offices folded into pincodes, sorted: each takes its delivering office's district, state and point,
 * the first office's where none delivers, and the middle of its offices' points where that office has none.
 */
export function pincodesOf(offices: readonly Office[]): DirectoryPincode[] {
  const byPincode = new Map<string, Office[]>();
  for (const office of offices) {
    const pincode = office.pincode.trim();
    if (!PINCODE.test(pincode)) continue;
    byPincode.set(pincode, [...(byPincode.get(pincode) ?? []), office]);
  }
  return [...byPincode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([pincode, all]) => {
      const head = all.find((office) => office.delivery.trim().toLowerCase() === "delivery") ?? all[0];
      if (head === undefined) return [];
      const points = all.flatMap((office) => {
        const point = pointOf(office);
        return point === null ? [] : [point];
      });
      const point = pointOf(head);
      const names = [...new Set(all.map((office) => office.officename.trim().replace(/\s+/g, " ")))].sort();
      return [
        {
          pincode,
          district: cleaned(head.district),
          state: cleaned(head.statename),
          officeNames: names.join(";"),
          latitude: point?.[0] ?? median(points.map(([lat]) => lat)),
          longitude: point?.[1] ?? median(points.map(([, lng]) => lng)),
        },
      ];
    });
}

const csvField = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', "'")}"` : value);

/** The CSV the repository keeps: a header, then one row a pincode. */
export function directoryCsv(rows: readonly DirectoryPincode[]): string {
  const lines = rows.map((row) =>
    [
      row.pincode,
      row.district,
      row.state,
      row.officeNames,
      row.latitude?.toFixed(6) ?? "",
      row.longitude?.toFixed(6) ?? "",
    ]
      .map(csvField)
      .join(","),
  );
  return `${[DIRECTORY_COLUMNS.join(","), ...lines].join("\n")}\n`;
}

/** The CSV read back. A row with no pincode, district or state is a broken file, and stops the load. */
export function readDirectoryCsv(text: string): DirectoryPincode[] {
  const [header = "", ...lines] = text.trim().split(/\r?\n/);
  const columns = fields(header);
  const missing = DIRECTORY_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) throw new Error(`the directory has no ${missing.join(", ")} column`);
  return lines.map((line, at) => {
    const row = fields(line);
    const cell = (name: (typeof DIRECTORY_COLUMNS)[number]) => row[columns.indexOf(name)]?.trim() ?? "";
    const coordinate = (name: "latitude" | "longitude") => (cell(name) === "" ? null : Number(cell(name)));
    const pincode = cell("pincode");
    if (!PINCODE.test(pincode) || cell("district") === "" || cell("state") === "") {
      throw new Error(`the directory's line ${String(at + 2)} names no pincode, district or state`);
    }
    return {
      pincode,
      district: cell("district"),
      state: cell("state"),
      officeNames: cell("office_names"),
      latitude: coordinate("latitude"),
      longitude: coordinate("longitude"),
    };
  });
}

/** The rows as SQL, a statement for each `per` of them, each replacing what pincode_directory held. */
export function directoryInserts(rows: readonly DirectoryPincode[], refreshedOn: string, per = 100): string[] {
  const statements: string[] = [];
  for (let at = 0; at < rows.length; at += per) {
    const values = rows.slice(at, at + per).map((row) => {
      const point = (value: number | null) => (value === null ? "NULL" : String(value));
      const cells = [row.pincode, row.district, row.state, row.officeNames, refreshedOn].map(sqlLiteral);
      return `(${cells.slice(0, 4).join(", ")}, ${point(row.latitude)}, ${point(row.longitude)}, ${cells[4] ?? "NULL"})`;
    });
    statements.push(`INSERT INTO pincode_directory (pincode, district, state, office_names, latitude, longitude, refreshed_on) VALUES
${values.join(",\n")}
ON CONFLICT (pincode) DO UPDATE SET district = excluded.district, state = excluded.state,
  office_names = excluded.office_names, latitude = excluded.latitude, longitude = excluded.longitude,
  refreshed_on = excluded.refreshed_on;`);
  }
  return statements;
}
