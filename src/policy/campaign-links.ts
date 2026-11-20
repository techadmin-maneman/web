// The links Growth make for a campaign (docs/decisions/0288-attribution-and-conversions.md, docs/tracking.md): a
// society activation's, at /s/<slug>, and an offer's for an ad, a post or a newsletter, at /o/<slug>. Each sends the
// visitor to /book with its campaign tags, so the touch they make carries them, and with its code. The tags follow one
// vocabulary: small letters and hyphens, a source and a medium from the lists below.

export type LinkKind = "society" | "offer";

/** Where an offer link is put. */
export const OFFER_SOURCES = ["google", "meta", "youtube", "whatsapp", "newsletter", "partner"] as const;

/** How it is put there: a paid ad, an unpaid post, an e-mail, or print. */
export const OFFER_MEDIUMS = ["cpc", "paid_social", "social", "email", "offline"] as const;

/** A society's tags are fixed. */
export const SOCIETY_SOURCE = "society";
export const SOCIETY_MEDIUM = "offline";

/** A slug or a campaign: small letters and digits, words joined by single hyphens. */
export const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_MAX = 40;
export const CAMPAIGN_MAX = 80;

/** Each link's path prefix on the site. */
export const LINK_PATH: Readonly<Record<LinkKind, string>> = { society: "/s/", offer: "/o/" };

/** Words as a slug: "Green Valley Towers" is green-valley-towers. */
export function slugFrom(words: string): string {
  return words
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** A society activation's campaign: its slug and its day, green-valley-towers-20261122. */
export const societyCampaign = (slug: string, heldDate: string): string => `${slug}-${heldDate.replaceAll("-", "")}`;

/** Where a link sends the visitor: /book with the link's tags and code. */
export function landingOf(link: {
  readonly kind: LinkKind;
  readonly code: string;
  readonly utmSource: string;
  readonly utmMedium: string;
  readonly utmCampaign: string;
}): string {
  const query = new URLSearchParams({
    utm_source: link.utmSource,
    utm_medium: link.utmMedium,
    utm_campaign: link.utmCampaign,
    [link.kind === "society" ? "soc" : "offer"]: link.code,
  });
  return `/book?${query.toString()}`;
}
