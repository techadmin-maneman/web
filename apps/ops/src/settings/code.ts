// The code a new service is priced under, made from its name as the API makes it (tierCodeOf,
// src/policy/services.ts), so the form shows it before the service is added. test/node/ops-service-code.test.ts
// holds the two to the same answers.

/** The longest a code may be (PRICE_TIER, src/config/ops-settings.ts). */
const CODE_LENGTH = 32;

/** A code as the price book takes it: small letters, digits and _, a letter first. */
export const CODE = /^[a-z][a-z0-9_]{0,31}$/;

/** "Premium" is premium, "Lace, front" is lace_front; nothing where the name gives no code. */
export function codeOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, CODE_LENGTH)
    .replace(/_+$/, "");
}
