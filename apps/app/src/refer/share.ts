// What a tap on WhatsApp or Other apps sends with an invite (docs/decisions/0048-referrals.md, amended 27 September
// 2026). Where the phone's share sheet takes files, the card goes as a photograph with the invite's words as its
// caption, so the friend sees it whether or not their chat draws the link's preview. Elsewhere WhatsApp's own link
// takes the words alone, and the chat draws the card from the landing's Open Graph tags. The try-on's WhatsApp button
// shares its look the same way (site/src/islands/tryon/Result.tsx).
//
// A share must start on the tap itself, so the sheet makes the card a file before its share step shows
// (ShareSheet.tsx); these only decide what the tap sends.

/** The name the card is sent under, so a friend who saves it has a file that says what it is. */
const INVITE_FILE = "mane-man-invite.jpg";

/** The card as the file a share sheet takes. */
export function inviteFile(card: Blob): File {
  return new File([card], INVITE_FILE, { type: "image/jpeg" });
}

/** What the phone's share sheet offers, as `navigator` has it. Either may be missing, as on most desktops. */
export interface Phone {
  readonly canShare?: (data: ShareData) => boolean;
  readonly share?: (data: ShareData) => Promise<void>;
}

/**
 * The card with the invite's words, where the phone can share the card as a file. Null where it cannot, or where
 * the card is not ready: WhatsApp's link then takes the words.
 */
export function withCard(phone: Phone, card: File | null, text: string): ShareData | null {
  if (card === null || phone.share === undefined || phone.canShare?.({ files: [card] }) !== true) return null;
  return { files: [card], text };
}

/**
 * What Other apps sends: the card with the words where the phone can share it, else the words alone. Null where the
 * phone has no share sheet at all, and the link is copied instead.
 */
export function forOtherApps(phone: Phone, card: File | null, text: string): ShareData | null {
  if (phone.share === undefined) return null;
  return withCard(phone, card, text) ?? { text };
}
