// A "Payment owed" task's one fact, as the API writes it: "sent 4500000 https://rzp.io/i/abc Mane Man Natural". The
// link's state, what it asks for in paise, its address ("-" until Razorpay made it), and the product's name.

/** Razorpay sent the link, has still to, refused it, or it closed unpaid. */
export const LINK_STATES = ["sent", "unsent", "refused", "closed"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export interface OwedLink {
  readonly state: LinkState;
  /** In paise. */
  readonly amount: number;
  readonly url: string | null;
  readonly product: string;
}

const isLinkState = (word: string): word is LinkState => (LINK_STATES as readonly string[]).includes(word);

/** The link the task is about; null for a detail that does not read as one. */
export function owedLinkOf(detail: string | null): OwedLink | null {
  const [state = "", amount = "", url = "", ...product] = detail?.split(" ") ?? [];
  if (!isLinkState(state) || amount === "" || Number.isNaN(Number(amount))) return null;
  return { state, amount: Number(amount), url: url === "-" || url === "" ? null : url, product: product.join(" ") };
}
