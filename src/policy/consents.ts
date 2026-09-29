// What a client consents to (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and the purposes they name. A client switches each in src/domain/profile.ts;
// ops read them in the console (src/routes/ops-clients.ts) and never write one. Each consent also records where it
// was given, as the owner ruled on 27 September 2026 (docs/decisions/0094-where-a-consent-was-given.md).

export const RULES = [
  "Each purpose carries its own date and can be switched by the client in the app. Ops can read them and never grant them. The purposes are:",
  "photographs for the client's own record",
  "photographs on referral cards",
  "photographs in marketing",
  "WhatsApp about visits",
  "WhatsApp about launches",
] as const;

/** The owner's ruling of 27 September 2026 (docs/open-points.md, item 50). */
export const SOURCE_RULE =
  "A consent records where it was given: the site's form, a booking in the app, the profile's switch, the technician.";

/** The five purposes, in the prompt's order. */
export const CONSENT_PURPOSES = [
  "photos_own_record",
  "photos_referral_cards",
  "photos_marketing",
  "whatsapp_visits",
  "whatsapp_launches",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Every place a consent is given, kept on its row. The owner's four, split where one screen or page is several:
 * the site's booking form, its waitlist and an invite's page; the site's try-on; the app's booking, profile and share
 * sheet; the technician, where nothing asks for one yet; and the withdrawal an erasure records.
 */
export const CONSENT_SOURCES = [
  "site_booking",
  "site_waitlist",
  "referral_landing",
  "try_on",
  "app_booking",
  "app_profile",
  "app_share_sheet",
  "technician",
  "erasure",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** The screens of the client app that switch a consent through the profile's own route. */
export const APP_SWITCH_SOURCES = [
  "app_profile",
  "app_booking",
  "app_share_sheet",
] as const satisfies readonly ConsentSource[];
export type AppSwitchSource = (typeof APP_SWITCH_SOURCES)[number];

/** What each screen asks for: the profile any purpose, the booking sheet its reminder, the share sheet its card. */
const ASKED_ON: Readonly<Record<AppSwitchSource, readonly ConsentPurpose[]>> = {
  app_profile: CONSENT_PURPOSES,
  app_booking: ["whatsapp_visits"],
  app_share_sheet: ["photos_referral_cards"],
};

/** Whether the screen asks for the purpose, so a switch of it may be recorded as made there. */
export function screenAsks(screen: AppSwitchSource, purpose: ConsentPurpose): boolean {
  return ASKED_ON[screen].includes(purpose);
}
