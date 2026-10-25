// India Post's pincodes (migration 0196), from which ops open a city: its state's districts and how much of each we
// hold, a district's pincodes with what each area would be called, and adding the ones ops tick, unserved, in one
// batch (./service-area.ts serves them). Read from the directory; nothing here changes it.

import { areaOf, fittedArea } from "../../policy/area-names.ts";
import { isActiveCity } from "../cities/cities.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { serviceArea, type AreaPincode } from "./service-area.ts";

export interface DirectoryDistrict {
  readonly state: string;
  readonly district: string;
  readonly pincodes: number;
  /** How many of them the service area already holds, served or not. */
  readonly held: number;
}

export interface DirectoryPincode {
  readonly pincode: string;
  readonly district: string;
  /** What the area would be called: the shortest of its post offices, until ops give it a name. */
  readonly area: string;
  readonly offices: string[];
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Where the service area already holds it: its city, its name, and whether it is served. */
  readonly held: { readonly city: string; readonly area: string; readonly served: boolean } | null;
}

/** The states the directory lists, in order. */
export async function directoryStates(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT state FROM pincode_directory ORDER BY state")
    .all<{ state: string }>();
  return results.map((row) => row.state);
}

/** A state's districts, each with its pincodes and how many we hold. */
export async function directoryDistricts(db: D1Database, state: string): Promise<DirectoryDistrict[]> {
  const { results } = await db
    .prepare(
      `SELECT d.state, d.district, COUNT(*) AS pincodes, COUNT(s.pincode) AS held
       FROM pincode_directory d LEFT JOIN serviceable_pincodes s ON s.pincode = d.pincode
       WHERE d.state = ?1 GROUP BY d.state, d.district ORDER BY d.district`,
    )
    .bind(state)
    .all<DirectoryDistrict>();
  return results;
}

/** A title for a district the directory spells in capitals: "GAUTAM BUDDHA NAGAR" → "Gautam Buddha Nagar". */
const titled = (name: string) => name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

/** What a pincode's area would be called, fitted to the names ops may give. */
const suggestedArea = (officeNames: string, district: string) =>
  fittedArea(areaOf(officeNames, titled(district)), titled(district));

/** The pincodes of these districts of a state, in order, with what we hold of each. */
export async function directoryPincodes(
  db: D1Database,
  state: string,
  districts: readonly string[],
): Promise<DirectoryPincode[]> {
  const { results } = await db
    .prepare(
      `SELECT d.pincode, d.district, d.office_names, d.latitude, d.longitude,
         s.city AS held_city, s.area AS held_area, s.served AS held_served
       FROM pincode_directory d LEFT JOIN serviceable_pincodes s ON s.pincode = d.pincode
       WHERE d.state = ?1 AND d.district IN (SELECT value FROM json_each(?2)) ORDER BY d.pincode`,
    )
    .bind(state, JSON.stringify(districts))
    .all<{
      pincode: string;
      district: string;
      office_names: string;
      latitude: number | null;
      longitude: number | null;
      held_city: string | null;
      held_area: string | null;
      held_served: number | null;
    }>();
  return results.map((row) => ({
    pincode: row.pincode,
    district: row.district,
    area: suggestedArea(row.office_names, row.district),
    offices: row.office_names === "" ? [] : row.office_names.split(";"),
    latitude: row.latitude,
    longitude: row.longitude,
    held:
      row.held_city === null ? null : { city: row.held_city, area: row.held_area ?? "", served: row.held_served === 1 },
  }));
}

/** Pincodes ops ticked in the directory or named in a file, each with the name they gave, if they gave one. */
export interface FromDirectory {
  readonly city: string;
  readonly pincodes: readonly { readonly pincode: string; readonly area?: string | undefined }[];
}

/**
 * Adds the pincodes asked for, unserved, in a city of ours, with an audit entry each, in one batch. One the service area
 * holds already is left as it is, and one the directory does not list is not added; both are named back. An area takes
 * the name ops gave it, which clients see, or else the one the directory suggests, which they are not shown until ops
 * name it (src/policy/area-names.ts). Those added come back as the service area lists them, with who waits.
 */
export async function addFromDirectory(
  db: D1Database,
  input: { readonly add: FromDirectory; readonly actor: AuditActor; readonly requestId: string; readonly now: Date },
): Promise<{ readonly added: AreaPincode[]; readonly held: string[]; readonly unlisted: string[] } | "unknown_city"> {
  const { add, actor, requestId, now } = input;
  if (!(await isActiveCity(db, add.city))) return "unknown_city";
  const { results } = await db
    .prepare(
      `SELECT d.pincode, d.office_names, d.district, s.pincode AS held
       FROM pincode_directory d LEFT JOIN serviceable_pincodes s ON s.pincode = d.pincode
       WHERE d.pincode IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(add.pincodes.map((each) => each.pincode)))
    .all<{ pincode: string; office_names: string; district: string; held: string | null }>();
  const listed = new Map(results.map((row) => [row.pincode, row]));
  const unlisted = add.pincodes.filter((each) => !listed.has(each.pincode)).map((each) => each.pincode);
  const held = results.filter((row) => row.held !== null).map((row) => row.pincode);
  const statements = add.pincodes.flatMap((each) => {
    const row = listed.get(each.pincode);
    if (row?.held !== null) return [];
    const suggested = suggestedArea(row.office_names, row.district);
    const area = each.area ?? suggested;
    return [
      db
        .prepare(
          `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
           VALUES (?1, ?2, ?3, 0, NULL, ?4)`,
        )
        .bind(each.pincode, area, add.city, area === suggested ? null : actor.id),
      auditStatement(
        db,
        {
          surface: "ops",
          actor,
          action: "pincode.add",
          subject: { kind: "pincode", id: each.pincode },
          requestId,
          detail: { city: add.city, from: "directory" },
        },
        now,
      ),
    ];
  });
  if (statements.length === 0) return { added: [], held, unlisted };
  await db.batch(statements);
  const adding = new Set(add.pincodes.map((each) => each.pincode).filter((each) => listed.has(each)));
  const added = (await serviceArea(db)).filter((each) => adding.has(each.pincode) && !held.includes(each.pincode));
  return { added, held, unlisted };
}
