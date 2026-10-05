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
  // A late fee's name, and a charge's row; the evidence is the design's ("cancelled 9:14 am, visit
  // was 10 am"), with the dates when the two fall on different days.
  lateFeeOf: (what: string) => `${what} · late fee`,
  charge: "Charge",
  charged: "Charged",
  evidence: (change: "cancelled" | "moved", at: string, visit: string) => `${change} ${at}, visit was ${visit}`,
  // The design draws no visit the client was not home for (LIFE-07).
  noShow: {
    meta: (note: { waited_minutes: number }) => `not home, we waited ${String(note.waited_minutes)} min`,
    label: "Not home",
    decision: { undecided: "under review", charged: "charged", waived: "not charged" },
    fact: (minutes: number, decision: string) => `We waited ${String(minutes)} minutes · ${decision}`,
  },
  // The design draws no discount code on a payment (docs/decisions/0108-discount-codes.md).
  discount: {
    label: "Discount code",
    /** "AUDTEST: Rs. 1,000 off", before GST; the code alone where what it took off is not known. */
    fact: (code: string, off: string | null) => (off === null ? code : `${code}: ${off} off`),
  },
  /** No board draws it. A one visit's payment still owed, above the payments made. */
  owed: {
    label: "To pay",
    meta: (date: string) => `Fitted ${date}`,
    pay: "Pay now",
    newTab: "opens Razorpay in a new tab",
    onItsWay: "Link on its way by text",
  },
  /**
   * The free service visits among the payments (LIFE-14). Board E1 draws a visit one covered: "Service visit ·
   * 25 Jul · visit credit · Covered by credit · Rs. 0 · 1 credit used". Our words: all of it, in the reward's
   * one name, which the row's name or meta says, so its status and count need not.
   */
  credits: {
    title: "Free service visits",
    meta: {
      used: "free service visit",
      lost: "cancelled late",
      returned: "cancelled in time",
      expired: "past their date",
      withdrawn: "the fit was refunded",
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
    // Our words from here to the refund's "created", and its "processed" and "failed".
    authorized: "Processing",
    refunded: "Refunded",
    partially_refunded: "Partly refunded",
    created: "Refund processing",
    processed: "Refunded",
    failed: "Refund being redone",
  },
  /**
   * How long a refund takes, beside "Refund processing". The design says "3 to 5 working days"; Razorpay's
   * normal refunds take 5 to 7, and the owner ruled the app says so (ADR 0025, item 28).
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
  // The design draws a payment's rows; a refund's "Refunded to" and "For" are ours.
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
  voucher: "Refund voucher",
  /**
   * Board E3's line for a document not yet raised. An invoice is raised once the visit is done, so what it says
   * depends on when that was (ADR 0056). Our words: every line but the invoice's first.
   */
  unavailable: {
    invoice: "The invoice is still generating. Usually ready within the hour.",
    invoiceAfterVisit: "The tax invoice is raised once the visit is done.",
    invoiceLate: "The invoice is taking longer than it should.",
    // Receipts and vouchers wait for the invoicing route (docs/open-points.md, item 3).
    receipt: "The receipt isn’t ready yet.",
    voucher: "The refund voucher isn’t ready yet.",
    notify: "Ask us for it",
  },
} as const;
