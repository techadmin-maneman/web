// Where stock is kept (docs/decisions/0155-the-stock-place-tree.md): the national warehouse at the top, a hub for a
// zone, a stockroom in a city, and each technician's kit, every place under one above it. A hub hangs from the
// warehouse, a stockroom from the warehouse or a hub, and a kit from any of them, so the tree has no loops.
//
// The warehouse keeps the central store's ID and a kit its technician's, so the ledger's rows from before the tree
// read as they did. A technician's kit comes with them (migration 0133) and is named by them; ops with a national
// grant add hubs and stockrooms, rename them, move them or a kit under another place, and close one that is empty.

import { reachBinding } from "../clients/places.ts";
import type { PlacesReached } from "../../policy/access.ts";
import { auditStatement, type AuditActor, type AuditEntry } from "../platform/audit.ts";

/** A place, by its ID: the warehouse is WAREHOUSE and a kit its technician's ID. */
export type Place = string;

export const WAREHOUSE = "central";

export const PLACE_KINDS = ["warehouse", "hub", "stockroom", "kit"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** How far down the tree each kind sits: a place hangs only from one above it. */
const DEPTH: Readonly<Record<PlaceKind, number>> = { warehouse: 0, hub: 1, stockroom: 2, kit: 3 };

export interface StockPlace {
  readonly id: Place;
  readonly kind: PlaceKind;
  /** A kit's is its technician's name. */
  readonly name: string;
  readonly parentId: Place | null;
  /** A hub's own; a stockroom's and a kit's by their city. */
  readonly zone: string | null;
  /** A stockroom's own; a kit's technician's. */
  readonly city: string | null;
  /** A kit is open while its technician is. */
  readonly active: boolean;
}

interface PlaceRow {
  readonly id: string;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly parent_id: string | null;
  readonly zone: string | null;
  readonly city: string | null;
  readonly active: number;
}

const PLACES = `SELECT p.id, p.kind, COALESCE(p.name, t.name) AS name, p.parent_id,
    COALESCE(p.zone, (SELECT c.zone FROM cities c WHERE c.name = COALESCE(p.city, t.city))) AS zone,
    COALESCE(p.city, t.city) AS city, p.active * COALESCE(t.active, 1) AS active
  FROM stock_places p LEFT JOIN technicians t ON t.id = p.technician_id`;

const placeOf = (row: PlaceRow): StockPlace => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  parentId: row.parent_id,
  zone: row.zone,
  city: row.city,
  active: row.active === 1,
});

/** A kit whose technician is gone, deleted as added by mistake, is no place. */
const STANDING = "(p.kind <> 'kit' OR t.id IS NOT NULL)";

/** Every place, down the tree: the warehouse, then the hubs, the stockrooms and the kits, each by name. */
export async function allPlaces(db: D1Database): Promise<StockPlace[]> {
  const { results } = await db
    .prepare(
      `${PLACES} WHERE ${STANDING} ORDER BY CASE p.kind WHEN 'warehouse' THEN 0 WHEN 'hub' THEN 1 WHEN 'stockroom' THEN 2 ELSE 3 END,
         COALESCE(p.name, t.name) COLLATE NOCASE`,
    )
    .all<PlaceRow>();
  return results.map(placeOf);
}

export async function placeById(db: D1Database, id: Place): Promise<StockPlace | null> {
  const row = await db.prepare(`${PLACES} WHERE p.id = ?1 AND ${STANDING}`).bind(id).first<PlaceRow>();
  return row === null ? null : placeOf(row);
}

/**
 * The places within reach, by ID; null when the reach is everywhere, so every one is. A kit is in its technician's
 * city and a stockroom in its own; a hub is reached only with every city of its zone, and the warehouse is in none.
 */
export async function placesWithin(db: D1Database, reached: PlacesReached): Promise<ReadonlySet<Place> | null> {
  if (reached.kind === "everywhere") return null;
  const { results } = await db
    .prepare(
      `SELECT p.id FROM stock_places p LEFT JOIN technicians t ON t.id = p.technician_id
       WHERE COALESCE(p.city, t.city) IN (SELECT value FROM json_each(?1))
          OR (p.kind = 'hub' AND EXISTS (SELECT 1 FROM cities c WHERE c.zone = p.zone)
              AND NOT EXISTS (SELECT 1 FROM cities c
                              WHERE c.zone = p.zone AND c.name NOT IN (SELECT value FROM json_each(?1))))`,
    )
    .bind(reachBinding(reached))
    .all<{ id: string }>();
  return new Set(results.map((row) => row.id));
}

/** The zones a hub may be for, and the active cities a stockroom may be in, in their order. */
export async function placeAreas(db: D1Database): Promise<{ zones: string[]; cities: string[] }> {
  const [zones, cities] = await db.batch<{ name: string }>([
    db.prepare("SELECT name FROM zones ORDER BY sort, name"),
    db.prepare("SELECT name FROM cities WHERE active = 1 ORDER BY sort, name"),
  ]);
  return {
    zones: (zones?.results ?? []).map((row) => row.name),
    cities: (cities?.results ?? []).map((row) => row.name),
  };
}

/** Whether a place is among those within reach, where null is every one. */
export const isPlaceWithin = (within: ReadonlySet<Place> | null, place: Place): boolean =>
  within === null || within.has(place);

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type PlaceAdded = { readonly ok: true; readonly id: Place } | { readonly ok: false; readonly fields: string[] };

export type PlaceChanged = PlaceAdded | { readonly ok: false; readonly missing: true };

/** A place another may hang from: open, and higher up the tree than `kind`. */
async function parentFor(db: D1Database, parentId: Place, kind: PlaceKind): Promise<StockPlace | null> {
  const parent = await placeById(db, parentId);
  return parent !== null && parent.active && DEPTH[parent.kind] < DEPTH[kind] ? parent : null;
}

async function nameTaken(db: D1Database, name: string, except: Place | null): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM stock_places WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2")
    .bind(name, except)
    .first();
  return row !== null;
}

function entry(
  action: "stock.place_add" | "stock.place_change",
  id: Place,
  written: Written,
  detail: AuditEntry["detail"],
): AuditEntry {
  return {
    surface: "ops",
    actor: written.actor,
    action,
    subject: { kind: "stock_place", id },
    requestId: written.requestId,
    detail,
  };
}

/** A hub for a zone, or a stockroom in a city, under a place above it. */
export async function addPlace(
  db: D1Database,
  input: {
    readonly kind: "hub" | "stockroom";
    readonly name: string;
    readonly parentId: Place;
    readonly area: string;
  },
  written: Written,
): Promise<PlaceAdded> {
  const fields: string[] = [];
  if (await nameTaken(db, input.name, null)) fields.push("name");
  if ((await parentFor(db, input.parentId, input.kind)) === null) fields.push("parent_id");
  const area =
    input.kind === "hub"
      ? db.prepare("SELECT 1 FROM zones WHERE name = ?1")
      : db.prepare("SELECT 1 FROM cities WHERE name = ?1 AND active = 1");
  if ((await area.bind(input.area).first()) === null) fields.push(input.kind === "hub" ? "zone" : "city");
  if (fields.length > 0) return { ok: false, fields };
  const id = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO stock_places (id, kind, name, parent_id, zone, city, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        id,
        input.kind,
        input.name,
        input.parentId,
        input.kind === "hub" ? input.area : null,
        input.kind === "stockroom" ? input.area : null,
        written.actor.id,
        at,
      ),
    auditStatement(
      db,
      entry("stock.place_add", id, written, { kind: input.kind, parent_id: input.parentId, area: input.area }),
      written.now,
    ),
  ]);
  return { ok: true, id };
}

interface PlaceChange {
  readonly name?: string | undefined;
  readonly parentId?: Place | undefined;
  readonly active?: boolean | undefined;
}

/** Why a change is refused, by the field it names: none when it may be made. */
async function refusedFields(db: D1Database, place: StockPlace, change: PlaceChange): Promise<string[]> {
  const fields: string[] = [];
  const named = change.name !== undefined && change.name !== place.name;
  if (named && (place.kind === "kit" || (await nameTaken(db, change.name ?? "", place.id)))) fields.push("name");
  const moved = change.parentId !== undefined && change.parentId !== place.parentId;
  if (moved && (place.kind === "warehouse" || (await parentFor(db, change.parentId ?? "", place.kind)) === null)) {
    fields.push("parent_id");
  }
  if (change.active === false && place.active && !(await mayClose(db, place))) fields.push("active");
  const reopened = change.active === true && !place.active;
  if (reopened && (place.kind === "kit" || (await parentFor(db, place.parentId ?? "", place.kind)) === null)) {
    fields.push("active");
  }
  return fields;
}

/** A hub or a stockroom closes once it holds nothing and no open place hangs from it; a kit closes with its technician. */
async function mayClose(db: D1Database, place: StockPlace): Promise<boolean> {
  if (place.kind === "warehouse" || place.kind === "kit") return false;
  const busy = await db
    .prepare(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM consumables c CROSS JOIN stock_balances b ON b.consumable_code = c.code
                              WHERE b.place = ?1 AND b.quantity <> 0)
         OR EXISTS (SELECT 1 FROM stock_places p LEFT JOIN technicians t ON t.id = p.technician_id
                    WHERE p.parent_id = ?1 AND p.active = 1 AND COALESCE(t.active, 1) = 1)`,
    )
    .bind(place.id)
    .first();
  return busy === null;
}

/** A place renamed, moved under another, or closed or opened again; a kit only moved. */
export async function changePlace(
  db: D1Database,
  id: Place,
  change: PlaceChange,
  written: Written,
): Promise<PlaceChanged> {
  const place = await placeById(db, id);
  if (place === null) return { ok: false, missing: true };
  const fields = await refusedFields(db, place, change);
  if (fields.length > 0) return { ok: false, fields };
  const name = change.name ?? (place.kind === "kit" ? null : place.name);
  const parentId = change.parentId ?? place.parentId;
  const active = place.kind === "kit" ? 1 : Number(change.active ?? place.active);
  await db.batch([
    db
      .prepare("UPDATE stock_places SET name = ?2, parent_id = ?3, active = ?4 WHERE id = ?1")
      .bind(id, name, parentId, active),
    auditStatement(
      db,
      entry("stock.place_change", id, written, {
        renamed: name !== null && name !== place.name,
        parent_id: parentId,
        active,
      }),
      written.now,
    ),
  ]);
  return { ok: true, id };
}
