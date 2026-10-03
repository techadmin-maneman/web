// A "Payment owed" task's one fact, as the API writes it: "sent 4500000 https://rzp.io/i/abc Mane Man Natural". The
// link's state, what it asks for in paise, its address ("-" until Razorpay made it), and the product's name.

export interface OwedLink {
  /** "sent", "unsent" or "refused". */
  readonly state: string;
  /** In paise. */
  readonly amount: number;
  readonly url: string | null;
  readonly product: string;
}

/** The link the task is about; null for a detail that does not read as one. */
export function owedLinkOf(detail: string | null): OwedLink | null {
  const [state = "", amount = "", url = "", ...product] = detail?.split(" ") ?? [];
  if (amount === "" || Number.isNaN(Number(amount))) return null;
  return { state, amount: Number(amount), url: url === "-" || url === "" ? null : url, product: product.join(" ") };
}
