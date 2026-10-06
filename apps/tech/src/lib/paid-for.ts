// What the client paid for, which the technician brings, as the card and the piece step both say it.

import type { Job } from "../api.ts";

/** The service the visit was sold as, by its name in the console; null where it names nothing beyond the kind. */
export function paidFor(job: Job): string | null {
  // A card kept on the phone before the API named the service has none.
  return job.service?.name ?? null;
}

/**
 * On a first fit, the product the hair profile names when it is not the one paid for, so the technician checks with
 * ops before they fit; null when they agree, or either names none.
 */
export function profileNamesAnother(job: Job): string | null {
  const service = job.service ?? null;
  const fit = job.profile?.fit ?? null;
  if (job.type !== "first_fit" || service === null || fit === null) return null;
  if (fit.product === null || fit.product === service.tier) return null;
  return fit.product_name ?? fit.product;
}
