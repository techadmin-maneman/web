// What a client consents to (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and the purposes they name. A client switches each in src/domain/profile.ts;
// ops read them in the console (src/routes/ops-clients.ts) and never write one.

export const RULES = [
  "Each purpose carries its own date and can be switched by the client in the app. Ops can read them and never grant them. The purposes are:",
  "photographs for the client's own record",
  "photographs on referral cards",
  "photographs in marketing",
  "WhatsApp about visits",
  "WhatsApp about launches",
] as const;

/** The five purposes, in the prompt's order. */
export const CONSENT_PURPOSES = [
  "photos_own_record",
  "photos_referral_cards",
  "photos_marketing",
  "whatsapp_visits",
  "whatsapp_launches",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
