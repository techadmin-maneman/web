// Payments (board E): what was paid, and an invoice.

export const payments = {
  title: "Payments",
  back: "Back to payments",
  // An entry that paid for no visit we know of.
  payment: "Payment",
  refund: "Refund",
  /** A refund as a WhatsApp asking for its voucher names it: "service visit refund on 2 Sep 2030". */
  refundOf: (what: string) => `${what} refund`,
  /** A refund's figure: money coming back, never another charge. */
  moneyBack: (amount: string) => `+ ${amount}`,
  backTo: (method: string) => `back to your ${method}`,
  // A late fee's name, and a charge's row: its evidence, "cancelled 9:14 am, visit was 10 am", with the dates when
  // the two fall on different days.
  lateFeeOf: (what: string) => `${what} · late fee`,
  /** The visit a payment was for, on its own day: "for 30 Aug". */
  forVisit: (date: string) => `for ${date}`,
  charge: "Charge",
  charged: "Charged",
  evidence: (change: "cancelled" | "moved", at: string, visit: string) => `${change} ${at}, visit was ${visit}`,
  // A visit the client missed.
  noShow: {
    meta: (note: { waited_minutes: number }) => `missed visit, we waited ${String(note.waited_minutes)} min`,
    label: "Missed visit",
    decision: { undecided: "under review", charged: "charged", waived: "not charged" },
    fact: (minutes: number, decision: string) => `We waited ${String(minutes)} minutes · ${decision}`,
  },
  // A discount code on a payment (docs/decisions/0108-discount-codes.md).
  discount: {
    label: "Discount code",
    /** "AUDTEST: Rs. 100 off", before GST; the code alone where what it took off is not known. */
    fact: (code: string, off: string | null) => (off === null ? code : `${code}: ${off} off`),
  },
  /** A one visit's payment still owed, above the payments made. */
  owed: {
    label: "To pay",
    meta: (date: string) => `Fitted ${date}`,
    pay: "Pay now",
    newTab: "opens Razorpay in a new tab",
    onItsWay: "Your payment link is on its way by text.",
  },
  /**
   * The free service visits among the payments, in the reward's one name, which the row's name or meta says, so its
   * status and count need not.
   */
  credits: {
    title: "Free service visits",
    meta: {
      used: "free service visit",
      lost: "cancelled late",
      returned: "cancelled in time",
      expired: "past their date",
      withdrawn: "the first fit was refunded",
      corrected: "corrected by us",
      added: "added",
    },
    /** Where visits added came from; an invite's by which side of it the client was. */
    from: {
      referrer: "your friend was fitted",
      friend: "from your invite",
      referral: "from an invite",
      ops: "from us",
      import: "carried over",
    },
    status: {
      used: "Covered",
      lost: "Not returned",
      returned: "Returned",
      expired: "Expired",
      withdrawn: "Withdrawn",
      corrected: "Corrected",
      added: "Added",
    },
    count: (event: string, visits: number) => {
      const counted = visits === 1 ? "1 visit" : `${String(visits)} visits`;
      if (event === "used") return `${counted} used`;
      if (event === "lost") return `${counted} lost`;
      if (event === "returned") return `${counted} back`;
      return counted;
    },
  },
  /** A payment's status, and a refund's. */
  status: {
    captured: "Paid",
    authorized: "Processing",
    refunded: "Refunded",
    partially_refunded: "Partly refunded",
    created: "Refund processing",
    processed: "Refunded",
    failed: "Refund delayed: we’re on it",
  },
  /**
   * How long a refund takes, beside "Refund processing". The design says "3 to 5 working days"; Razorpay's
   * normal refunds take 5 to 7, and the app says so (ADR 0025, item 28).
   */
  speed: { normal: "5 to 7 working days" } as Readonly<Record<string, string>>,
  // A refund still processing after Razorpay's working days, which the client should hear about.
  lateRefund: "Refund processing · taking longer than it should",
  message: "Message us",
  // An entry that is not this client's, or no longer exists.
  notFound: "We couldn’t find this payment.",
  /** A method as a list's meta line writes it ("22 Aug · UPI"), and as the detail's row does ("UPI"). */
  methods: {
    upi: ["UPI", "UPI"],
    card: ["card", "Card"],
    netbanking: ["net banking", "Net banking"],
    wallet: ["wallet", "Wallet"],
    emi: ["EMI", "EMI"],
    paylater: ["pay later", "Pay later"],
  } as Readonly<Record<string, readonly [string, string]>>,
  /** Where a refund goes, as "back to your …" says it: never "back to your net banking". */
  refundTo: {
    upi: "UPI",
    card: "card",
    netbanking: "bank account",
    wallet: "wallet",
    emi: "card",
    paylater: "pay-later account",
  } as Readonly<Record<string, string>>,
  rows: {
    date: "Date",
    method: "Method",
    destination: "Refunded to",
    status: "Status",
    reference: "Reference",
    for: "For",
  },
  documents: "Tax documents",
  invoice: "Tax invoice",
  /** Said to a screen reader only, since a document opens outside the app. */
  newTab: "PDF, opens in a new tab",
  receipt: "Receipt",
  /** A document the API would not give when it was tapped. */
  notOpened: "That didn’t open. Try again.",
  /**
   * The documents' line for a document not yet raised. An invoice is raised once the visit is done, so what it says
   * depends on when that was (ADR 0056).
   */
  unavailable: {
    invoice: "Your invoice will be ready within the hour.",
    invoiceAfterVisit: "Your invoice comes after the visit.",
    invoiceLate: "Your invoice is taking longer than it should.",
    receipt: "Your receipt will be here shortly.",
    notify: "Ask us for it",
  },
} as const;
