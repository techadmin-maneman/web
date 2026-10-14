// A client matched to stock (docs/decisions/0173-matching-a-client-to-stock.md): their latest hair profile's product,
// base size, colour, grey and density matched exactly to one stock code, never a near one or one cut down; then where
// that code's free pieces are held, the client's city first, never one reserved to a custom order. With no stock code
// made to their spec, theirs is a custom order.

import { latestFits } from "../clients/hair-profiles.ts";
import { cityOf } from "../clients/places.ts";
import { hairSystemSpecs, matchingCode } from "./hair-systems.ts";
import { read, readAll } from "../../lib/read-all.ts";

const consumableName = (db: D1Database, code: string) =>
  db.prepare("SELECT name FROM consumables WHERE code = ?1").bind(code).first<string>("name");

/** The profile's fields a match needs, in the profile's own names. */
export const MATCHED_FIELDS = [
  "product",
  "base_width_in",
  "base_length_in",
  "colour",
  "grey_percent",
  "density_percent",
] as const;

interface HeldAt {
  readonly placeId: string;
  /** The place's name; a kit's is its technician's. */
  readonly name: string;
  readonly kind: string;
  readonly city: string | null;
  readonly pieces: number;
}

export type StockMatch =
  | { readonly kind: "no_profile" }
  | { readonly kind: "incomplete"; readonly missing: readonly (typeof MATCHED_FIELDS)[number][] }
  | { readonly kind: "custom" }
  | {
      readonly kind: "stocked";
      readonly code: string;
      readonly name: string;
      readonly city: string | null;
      /** Every place holding a piece of it, the client's city first, then the most held. */
      readonly held: readonly HeldAt[];
      readonly inTransit: number;
    };

type HeldRow = { place_id: string; name: string | null; kind: string; city: string | null; pieces: number };

export async function stockMatch(db: D1Database, personId: string): Promise<StockMatch> {
  const fit = (await latestFits(db, [personId])).get(personId);
  if (fit === undefined) return { kind: "no_profile" };
  const missing = MATCHED_FIELDS.filter((field) => fit[field] === null);
  if (missing.length > 0) return { kind: "incomplete", missing };
  const matched = matchingCode(await hairSystemSpecs(db), fit);
  if (matched === null) return { kind: "custom" };
  const code = { code: matched, name: (await consumableName(db, matched)) ?? matched };
  const city = await cityOf(db, "client", personId);
  const { held, moving } = await readAll(db, {
    held: read<HeldRow>(
      db
        .prepare(
          `SELECT p.id AS place_id, COALESCE(p.name, t.name) AS name, p.kind, COALESCE(p.city, t.city) AS city,
           COUNT(*) AS pieces
         FROM stock_units u JOIN stock_places p ON p.id = u.place LEFT JOIN technicians t ON t.id = p.id
         WHERE u.state = 'held' AND u.consumable_code = ?1 AND u.custom_order_id IS NULL
         GROUP BY p.id ORDER BY COALESCE(p.city, t.city) IS ?2 DESC, pieces DESC`,
        )
        .bind(code.code, city),
    ),
    moving: read<{ pieces: number }>(
      db
        .prepare(
          "SELECT COUNT(*) AS pieces FROM stock_units WHERE state = 'in_transit' AND consumable_code = ?1 AND custom_order_id IS NULL",
        )
        .bind(code.code),
    ),
  });
  return {
    kind: "stocked",
    code: code.code,
    name: code.name,
    city,
    held: held.map((row) => ({
      placeId: row.place_id,
      name: row.name ?? row.place_id,
      kind: row.kind,
      city: row.city,
      pieces: row.pieces,
    })),
    inTransit: moving[0]?.pieces ?? 0,
  };
}
