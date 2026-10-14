// When a vendor that keeps failing is held off (src/domain/platform/vendor-breakers.ts): after this many failures in a
// row that are not the vendor refusing a record, its work waits this long before it is tried again.

export const BREAKER_FAILURES = 5;
export const BREAKER_HOLD_MINUTES = 15;

/** Each vendor held off as a whole, by the name ops know it by. */
export const BREAKER_VENDORS = { crm: "Zoho CRM" } as const;
export type BreakerVendor = keyof typeof BREAKER_VENDORS;
