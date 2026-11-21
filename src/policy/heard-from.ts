// What a client told us when asked how they heard of us (docs/decisions/0288-attribution-and-conversions.md). Ops pick
// it in the console, with words of their own for "other". It is kept beside the channel the touches give
// (./channels.ts), never in place of it, so the two can be set side by side.

export const HEARD_FROM = [
  { code: "google", label: "Google" },
  { code: "instagram_facebook", label: "Instagram or Facebook" },
  { code: "youtube", label: "YouTube" },
  { code: "friend", label: "Friend or family" },
  { code: "society", label: "Society event" },
  { code: "salon_partner", label: "Salon or partner" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "flyer", label: "Flyer or poster" },
  { code: "other", label: "Other" },
] as const;

export type HeardFrom = (typeof HEARD_FROM)[number]["code"];

export const HEARD_FROM_CODES = HEARD_FROM.map((each) => each.code) as [HeardFrom, ...HeardFrom[]];

/** The longest "other" ops may type. */
export const HEARD_FROM_OTHER_MAX = 80;
