// A package ops sell (docs/decisions/0211-packages.md), as the console sets one up: its first fit, service visit and
// replacement under its code, its figures, its service visit and replacement priced, and one hair system priced so
// its first fit costs `firstFit` before GST, the service visit with it. Every name is made up.

import { env } from "cloudflare:workers";
import { AT, writeRow } from "./rows.ts";

export interface PackageSold {
  readonly code: string;
  readonly name?: string;
  /** What its first fit costs before GST: the hair system's price and the service visit's. */
  readonly firstFit: number;
  /** Its service visit's price before GST. */
  readonly serviceVisit?: number;
  /** What its replacement costs before GST, its service visit with it. */
  readonly replacement?: number;
  readonly gstPercent?: number;
  readonly validFrom?: string;
  readonly sort?: number;
  readonly firstFitMinutes?: number;
  readonly everyDays?: number;
  readonly afterMonths?: number;
  /** Its hair system's spec, matched exactly to a client's profile. */
  readonly spec?: {
    readonly baseWidthIn: number;
    readonly baseLengthIn: number;
    readonly colour: string;
    readonly greyPercent: number;
    readonly densityPercent: number;
  };
}

const SPEC = { baseWidthIn: 8, baseLengthIn: 10, colour: "1B", greyPercent: 0, densityPercent: 100 } as const;

/** The package and its parts; its hair system's stock code. */
export async function aPackage(sold: PackageSold): Promise<{ readonly hairSystem: string }> {
  const name = sold.name ?? "Mane Man Essential";
  const visit = sold.serviceVisit ?? 200000;
  const service = (kind: string, suffix: string, minutes: number) =>
    writeRow(
      "services",
      {
        kind,
        tier: sold.code,
        name: `${name}${suffix}`,
        minutes,
        sort: sold.sort ?? 1,
        updated_by: "ops@localhost",
        updated_at: AT,
      },
      {},
    );
  await service("first_fit", "", sold.firstFitMinutes ?? 180);
  await service("service", " service visit", 90);
  await service("replacement", " replacement", 135);
  await writeRow(
    "packages",
    {
      code: sold.code,
      service_every_days: sold.everyDays ?? 30,
      replace_after_months: sold.afterMonths ?? 6,
      updated_by: "ops@localhost",
      updated_at: AT,
    },
    {},
  );
  const price = (item: string, amount: number) =>
    env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(item, sold.code, amount, sold.gstPercent ?? 0, sold.validFrom ?? "2026-01-01");
  await env.DB.batch([price("service", visit), price("replacement", (sold.replacement ?? 1500000) - visit)]);
  return aHairSystemOf(sold);
}

/**
 * A hair system in a package that is already set up, the standard one the migrations leave among them, priced so its
 * first fit costs `firstFit` before GST with the package's service visit at `serviceVisit`.
 */
export async function aHairSystemOf(sold: PackageSold): Promise<{ readonly hairSystem: string }> {
  const name = sold.name ?? "Mane Man Essential";
  const spec = sold.spec ?? SPEC;
  const hairSystem = `hs_${sold.code}_${String(spec.baseWidthIn)}x${String(spec.baseLengthIn)}_${spec.colour}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 32);
  await writeRow(
    "consumables",
    {
      code: hairSystem,
      name: `${name} · ${hairSystem}`,
      unit: "piece",
      unit_cost: 800000,
      created_at: AT,
      updated_at: AT,
    },
    {},
  );
  await writeRow(
    "hair_systems",
    {
      code: hairSystem,
      product: sold.code,
      base_width_in: spec.baseWidthIn,
      base_length_in: spec.baseLengthIn,
      colour: spec.colour,
      grey_percent: spec.greyPercent,
      density_percent: spec.densityPercent,
    },
    {},
  );
  await env.DB.prepare(
    "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('hair_system', ?1, ?2, ?3, ?4)",
  )
    .bind(
      hairSystem,
      sold.firstFit - (sold.serviceVisit ?? 200000),
      sold.gstPercent ?? 0,
      sold.validFrom ?? "2026-01-01",
    )
    .run();
  return { hairSystem };
}

/**
 * A hair system of the generic first fit the migrations began with, which is sold until 2 October 2026: so it costs
 * what the migrations priced it at, Rs. 30,000 before GST with its service visit, at 5% GST until 22 September
 * (migrations 0016 and 0018).
 */
export async function aGenericFirstFit(): Promise<{ readonly hairSystem: string }> {
  const sold = await aHairSystemOf({ code: "standard", name: "First fit", firstFit: 3000000, gstPercent: 5 });
  await env.DB.prepare(
    "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('hair_system', ?1, 2800000, 0, '2026-09-22')",
  )
    .bind(sold.hairSystem)
    .run();
  return sold;
}
