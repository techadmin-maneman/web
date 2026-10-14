// Hair systems in stock (docs/decisions/0156-hair-systems-in-stock.md): a stock code for each product, base size,
// colour, grey and density kept, counted in pieces in the consumables' ledger. Its consumables row holds its name, cost
// and levels, so transfers, counts, losses and low stock take it as any consumable; its spec is a row of hair_systems,
// which no two share. A piece fitted comes out of the technician's kit as the piece step lands
// (src/domain/inventory/piece-use.ts).

import { serviceOf } from "../booking/services.ts";
import { freshCode } from "../../lib/slug.ts";
import { insertRow } from "../../lib/sql.ts";
import { auditStatement, type Written } from "../platform/audit.ts";
import { type Refusal, refusal } from "../../lib/refusal.ts";

/** What a stock code is made to, matched exactly against a client's hair profile. */
export interface HairSystemSpec {
  /** The tier of the first-fit service it is sold as. */
  readonly product: string;
  readonly baseWidthIn: number;
  readonly baseLengthIn: number;
  readonly colour: string;
  readonly greyPercent: number;
  readonly densityPercent: number;
}

interface SpecRow {
  readonly code: string;
  readonly product: string;
  readonly base_width_in: number;
  readonly base_length_in: number;
  readonly colour: string;
  readonly grey_percent: number;
  readonly density_percent: number;
}

const SPEC_COLUMNS =
  "h.code, h.product, h.base_width_in, h.base_length_in, h.colour, h.grey_percent, h.density_percent";

const specOf = (row: SpecRow): HairSystemSpec => ({
  product: row.product,
  baseWidthIn: row.base_width_in,
  baseLengthIn: row.base_length_in,
  colour: row.colour,
  greyPercent: row.grey_percent,
  densityPercent: row.density_percent,
});

/** Every hair system's spec, by its stock code. */
export async function hairSystemSpecs(db: D1Database): Promise<Map<string, HairSystemSpec>> {
  const { results } = await db.prepare(`SELECT ${SPEC_COLUMNS} FROM hair_systems h`).all<SpecRow>();
  return new Map(results.map((row) => [row.code, specOf(row)]));
}

/** A fit as a stock code is matched to it, in the hair profile's names: the product, base, colour, grey and density. */
interface Fit {
  readonly product: string | null;
  readonly base_width_in: number | null;
  readonly base_length_in: number | null;
  readonly colour: string | null;
  readonly grey_percent: number | null;
  readonly density_percent: number | null;
}

/**
 * The stock code made exactly to this fit: its product, base size, colour, grey and density all the same, never a near
 * one or one cut down (docs/decisions/0173-matching-a-client-to-stock.md). Null where none is.
 */
export function matchingCode(specs: ReadonlyMap<string, HairSystemSpec>, fit: Fit): string | null {
  for (const [code, spec] of specs) {
    if (
      spec.product === fit.product &&
      spec.baseWidthIn === fit.base_width_in &&
      spec.baseLengthIn === fit.base_length_in &&
      spec.colour === fit.colour &&
      spec.greyPercent === fit.grey_percent &&
      spec.densityPercent === fit.density_percent
    ) {
      return code;
    }
  }
  return null;
}

/** Whether a stock code is a hair system's. */
export async function isHairSystem(db: D1Database, code: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM hair_systems WHERE code = ?1").bind(code).first()) !== null;
}

const inches = (value: number) => String(Math.round(value * 10) / 10);

/** "Mane Man Essential 8x10 1B, 20% grey, 100%": the product as it is sold, then the spec. */
const hairSystemName = (productName: string, spec: HairSystemSpec): string =>
  `${productName} ${inches(spec.baseWidthIn)}x${inches(spec.baseLengthIn)} ${spec.colour}, ` +
  `${String(spec.greyPercent)}% grey, ${String(spec.densityPercent)}%`;

interface NewHairSystem extends HairSystemSpec {
  readonly unitCost: number;
  readonly reorderKit: number | null;
  readonly reorderCentral: number | null;
  readonly reorderStore?: number | null;
}

/**
 * Adds a stock code for a spec, counted in pieces, with its audit entry. A product no first fit is sold as is refused,
 * and so is a spec, or the name it makes, that another has.
 */
export async function addHairSystem(
  db: D1Database,
  added: NewHairSystem,
  written: Written,
): Promise<{ readonly ok: true; readonly code: string } | Refusal<"invalid_request">> {
  const service = await serviceOf(db, "first_fit", added.product);
  if (service === null) return refusal("invalid_request", ["product"]);
  const name = hairSystemName(service.name, added);
  const taken = await db
    .prepare(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM consumables WHERE name = ?1 COLLATE NOCASE)
         OR EXISTS (SELECT 1 FROM hair_systems WHERE product = ?2 AND base_width_in = ?3 AND base_length_in = ?4
                      AND colour = ?5 AND grey_percent = ?6 AND density_percent = ?7)`,
    )
    .bind(
      name,
      added.product,
      added.baseWidthIn,
      added.baseLengthIn,
      added.colour,
      added.greyPercent,
      added.densityPercent,
    )
    .first();
  if (taken !== null) return refusal("invalid_request", ["hair_system"]);

  const { results } = await db.prepare("SELECT code FROM consumables").all<{ code: string }>();
  const words = `hs ${added.product} ${inches(added.baseWidthIn)}x${inches(added.baseLengthIn)} ${added.colour}`;
  const code = freshCode(
    `${words} g${String(added.greyPercent)} d${String(added.densityPercent)}`,
    32,
    "hair_system",
    new Set(results.map((row) => row.code)),
  );
  const at = written.now.toISOString();
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "consumable.add",
        subject: { kind: "consumable", id: code },
        requestId: written.requestId,
        detail: { unit: "piece", unit_cost: added.unitCost, hair_system: true },
      },
      written.now,
    ),
    insertRow(db, "consumables", {
      code,
      name,
      unit: "piece",
      unit_cost: added.unitCost,
      reorder_kit: added.reorderKit,
      reorder_central: added.reorderCentral,
      reorder_store: added.reorderStore ?? null,
      created_at: at,
      updated_at: at,
    }),
    insertRow(db, "hair_systems", {
      code,
      product: added.product,
      base_width_in: added.baseWidthIn,
      base_length_in: added.baseLengthIn,
      colour: added.colour,
      grey_percent: added.greyPercent,
      density_percent: added.densityPercent,
    }),
  ]);
  return { ok: true, code };
}

/** A hair system a technician's kit holds, with its spec, for the piece step to pick and match. */
export interface KitHairSystem extends HairSystemSpec {
  readonly code: string;
  readonly name: string;
  readonly held: number;
}

/** The hair systems a technician's kit holds today, by name: none retired by the day, none it holds none of. */
export async function kitHairSystems(db: D1Database, technicianId: string, today: string): Promise<KitHairSystem[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SPEC_COLUMNS}, c.name, b.quantity AS held
       FROM hair_systems h
       CROSS JOIN stock_balances b ON b.consumable_code = h.code AND b.place = ?1
       JOIN consumables c ON c.code = h.code
       WHERE b.quantity > 0 AND (c.retired_date IS NULL OR c.retired_date > ?2)
       ORDER BY c.name COLLATE NOCASE`,
    )
    .bind(technicianId, today)
    .all<SpecRow & { name: string; held: number }>();
  return results.map((row) => ({ ...specOf(row), code: row.code, name: row.name, held: row.held }));
}
