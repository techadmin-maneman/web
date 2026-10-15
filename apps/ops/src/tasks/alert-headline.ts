// What an alert on Tasks says first: its first sentence, without the system IDs an engineer needs, which its Details
// keep with the rest of its words.

/** A UUID, a vendor's long number, or a Razorpay ID. */
const ID = String.raw`(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{12,}\b|\b(?:pay|rfnd|order|plink|inv)_[A-Za-z0-9]+)`;

/** Brackets around an ID, with whatever else they say of it. */
const BRACKETED_ID = new RegExp(String.raw`\s*\([^()]*${ID}[^()]*\)`, "g");
const BARE_ID = new RegExp(String.raw`\s*${ID}`, "g");

export function headlineOf(message: string): string {
  const first = message.split(/(?<=[.!?])\s/)[0] ?? message;
  return first
    .replace(BRACKETED_ID, "")
    .replace(BARE_ID, "")
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/\.{2,}$/, ".")
    .trim();
}
