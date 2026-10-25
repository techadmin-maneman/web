// Finance's Payments page, the ledger: every payment over a period and the links still unpaid. No design draws it;
// every word here is ours.

export const ledger = {
  title: "Payments",
  from: "From",
  to: "To",
  narrow: "Filter payments",
  export: "Export CSV",
  /** The file's name: "payments-2026-09-01-to-2026-09-30.csv". */
  fileName: (from: string, to: string) => `payments-${from}-to-${to}.csv`,
  /** Beside the title: the days listed. */
  counted: (from: string, to: string) => `${from} to ${to}`,
  failed: "Couldn’t load the payments.",
  payments: {
    title: "Payments",
    columns: ["Date", "Reference", "Client", "For", "Method", "Amount", "Refunded", "Status", "Books"],
    more: (cap: number) => `Showing the latest ${String(cap)}. Choose fewer days to see the rest.`,
  },
  kinds: { visit: "Visit", late_fee: "Late fee" } as Readonly<Record<string, string | undefined>>,
  methods: { upi: "UPI", card: "Card", netbanking: "Net banking", wallet: "Wallet" } as Readonly<
    Record<string, string | undefined>
  >,
  statuses: {
    authorized: "Processing",
    captured: "Paid",
    failed: "Failed",
    refunded: "Refunded",
    partially_refunded: "Partly refunded",
  } as Readonly<Record<string, string | undefined>>,
  books: { applied: "In Books", waiting: "Not yet", none: "—" },
  /** A client erased since, or a payment no client of ours made. */
  noClient: "—",
  links: {
    title: "Payment links not paid",
    columns: ["Made", "Reference", "Client", "Amount", "State"],
    none: "Every link is paid.",
    states: { sent: "Sent", unsent: "Not sent", refused: "Refused by Razorpay", closed: "Closed unpaid" },
  },
};
