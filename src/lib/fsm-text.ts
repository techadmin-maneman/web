// Text as Zoho FSM keeps it, tried on the owner's org on 30 September 2026 (docs/decisions/fsm-trial.md,
// "Text FSM keeps").

/** The most a service address's Street_1 or Street_2 takes: FSM refuses 256 characters with INVALID_DATA. */
export const FSM_STREET_MAX = 255;

/** Characters past U+FFFF, such as 🙏 or 🇮🇳. FSM keeps ✅ and ❤️, which come before it. */
const PAST_U_FFFF = /[\u{10000}-\u{10FFFF}]/gu;

/**
 * Text FSM will keep whole, in at most `max` characters. FSM answers success and silently drops everything from
 * the first character past U+FFFF, so those are left out and the rest kept. Text still too long ends in "…".
 */
export function fsmText(text: string, max: number): string {
  const kept = text.replace(PAST_U_FFFF, "").replace(/ {2,}/g, " ").trim();
  return kept.length <= max ? kept : `${kept.slice(0, max - 1).trimEnd()}…`;
}
