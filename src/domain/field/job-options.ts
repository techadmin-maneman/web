// What a technician shows a client at their consultation, on the phone's Options (src/routes/tech/options.ts): each
// package on sale in the client's city that day, its first fit priced for the client as their app prices it, its
// service visit and replacement and how often each falls due. Prices come from the price book alone. The client's
// try-on looks beside them are src/domain/try-on/client-try-ons.ts's.

import type { Price } from "../money/price-lookup.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { unlocked } from "../../policy/job-visibility.ts";
import { pricedFor } from "../booking/client-prices.ts";
import { allPackages } from "../booking/packages.ts";
import { offeredServices } from "../booking/services.ts";

/** A consultation of the technician's, once its card is unlocked. */
export interface OptionsJob {
  readonly id: string;
  readonly personId: string;
  /** India's date of the visit, which prices are read on. */
  readonly on: string;
  readonly city: string | null;
}

export interface PackageOption {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly first_fit: Price;
  /** Null where the book prices it from no day up to the visit's. */
  readonly service: Price | null;
  readonly service_every_days: number;
  readonly replacement: Price | null;
  readonly replace_after_months: number;
}

/** The technician's consultation under the card's own unlock; null for any other job, or before it opens. */
export async function optionsJob(
  db: D1Database,
  options: { technicianId: string; jobId: string; now: Date; unlockHour: number },
): Promise<OptionsJob | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.window_start, a.type, a.person_id, a.service_city FROM appointments a
       WHERE a.technician_id = ?1 AND a.id = ?2 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL`,
    )
    .bind(options.technicianId, options.jobId)
    .first<{ id: string; window_start: string; type: string; person_id: string; service_city: string | null }>();
  if (row?.type !== "consultation") return null;
  const startsAt = new Date(row.window_start);
  if (!unlocked(startsAt, options.now, options.unlockHour)) return null;
  return { id: row.id, personId: row.person_id, on: indiaDate(startsAt), city: row.service_city };
}

/** Each package whose first fit is on sale on the visit's day, in the order ops gave them. */
export async function packageOptions(db: D1Database, job: OptionsJob): Promise<PackageOption[]> {
  const [offered, packages] = await Promise.all([
    offeredServices(db, job.on, ["first_fit", "service", "replacement"], job.city),
    allPackages(db),
  ]);
  const priced = await pricedFor(db, offered, { personId: job.personId, on: job.on, city: job.city });
  const priceOf = (kind: string, code: string) =>
    priced.find((service) => service.kind === kind && service.tier === code)?.price ?? null;
  return packages.flatMap((each) => {
    const firstFit = priceOf("first_fit", each.code);
    if (firstFit === null) return [];
    return [
      {
        code: each.code,
        name: each.name,
        description: each.description,
        first_fit: firstFit,
        service: priceOf("service", each.code),
        service_every_days: each.service_every_days,
        replacement: priceOf("replacement", each.code),
        replace_after_months: each.replace_after_months,
      },
    ];
  });
}
