// The privacy and terms pages.

/**
 * The privacy page's sentences on the try-on: its look goes to WhatsApp only, and a client's try-on is kept
 * (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md, 0084-a-clients-try-on-is-kept.md).
 */
// PLACEHOLDER: the try-on's sentences await counsel with the notices (docs/open-points.md, item 146).
const TRY_ON_PRIVACY =
  "If you use the try-on, your photograph is used to make your simulation. It is sent to AILabTools, the service that generates it, we never use it to train any model, and it is deleted within the hour, and in any case within thirty days. Before the simulation is made, you give us your name and mobile number: we send the simulation to that number on WhatsApp, and it is never shown on this site; the simulation itself is kept for fourteen days. If you then book a visit while the simulation is kept, we keep a small copy of your photograph in your Mane Man account as your before photo, until you ask us to delete it, and the simulation until the photographs of your first fit are taken; you see both when you sign in.";

interface LegalSection {
  readonly heading: string;
  /** "{whatsapp}" in a paragraph is the business number, shown as a link to a WhatsApp chat. */
  readonly paragraphs: readonly string[];
}

export interface LegalPage {
  readonly publish: boolean;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

/** The two long-form pages, a heading per topic. Their wording for the apps is a draft for counsel. */
export const legalPages: { readonly privacy: LegalPage; readonly terms: LegalPage } = {
  privacy: {
    publish: true,
    approved: false,
    title: "Privacy",
    sections: [
      {
        heading: "What we keep",
        paragraphs: [
          "Mane Man Grooming Services Private Limited collects only what it needs to arrange your visits and your simulation. When you book, we keep your name, mobile number, the address the visit is at, preferred visit time and the extent of your hair loss, with how you reached this site.",
          "Once you are a client, we also keep what your visits need: the photographs taken at each visit; your hair profile, which records your fit and what you tell us of treatments you have tried, skin conditions and allergies; and your visits, payments, refunds and credits.",
        ],
      },
      {
        heading: "Who holds it",
        paragraphs: [
          // PLACEHOLDER: counsel sees this wording, which no longer names Zoho FSM, before production (docs/open-points.md, item 149).
          "Your details are held in our own database, hosted by Cloudflare, where your visits are arranged, and in the customer system our team works from, Zoho CRM. Your hair profile stays in our own database. Payments are made through Razorpay. Our invoices are kept in Zoho Books, made out to your name, number and address.",
          "We use your details to arrange and look after your visits, and for anything else only with your agreement, which you can withdraw in the app or by messaging us at {whatsapp}. To stop our WhatsApp messages, reply STOP to any of them. We never sell your details.",
        ],
      },
      {
        heading: "The try-on",
        paragraphs: [
          TRY_ON_PRIVACY,
          // PLACEHOLDER: the try-on's cookie sentence awaits counsel with its notices (docs/open-points.md, item 146).
          "The site sets one cookie of its own, for the try-on: it remembers for thirty days that this browser has had its one look.",
        ],
      },
      {
        heading: "Invites and analytics",
        paragraphs: [
          // PLACEHOLDER: the invite's sentence awaits counsel (docs/open-points.md, item 156).
          "When you open a friend's invite, this browser keeps the invite's code for thirty days, so that a consultation you book here later still comes with it; it is removed once a booking has used it, or on your first visit after the thirty days.",
          "We count visits with Cloudflare Web Analytics, and measure our advertising with Google Analytics, Google Ads and Meta, which set their own cookies and never receive your name, number or photograph. Visitors' network addresses are kept only in scrambled form, to limit abuse.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          // PLACEHOLDER: the periods, for counsel to confirm (open point 149).
          "Once you are a client, we keep your details, your address and your visit photographs until you ask us to erase them. If you never book a visit or pay us, we erase your details a year after you last used the site or the app. A waitlist place goes a year after we launch in your area. Where a technician checked in at your door is kept only until a no-show charge can no longer be disputed. Invoices are kept for eight years, as the law requires.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Under India's Digital Personal Data Protection Act, 2023, you can ask what we hold about you, have it corrected, or have it erased. In the app you can download your data, correct your details and ask us to delete your account; anyone can message us on WhatsApp at {whatsapp}.",
          "We decide a request to erase within 30 days. Erasing deletes your photographs and clears your name, number and address from our records; your visits, payments and invoices stay as records. If a visit is still booked, or we hold a payment of yours, we settle that first.",
        ],
      },
    ],
  },
  terms: {
    publish: true,
    approved: false,
    title: "Terms",
    sections: [
      {
        heading: "These terms",
        paragraphs: [
          "These terms cover the service Mane Man Grooming Services Private Limited provides: non-surgical hair systems, measured, fitted and serviced at your home across Delhi NCR. By booking a visit or using the try-on you agree to them. We may change them; the version on this page when you book is the one that applies to that booking.",
        ],
      },
      {
        heading: "Your visits",
        paragraphs: [
          "The first visit is a consultation: an hour, free, and with no obligation to order. Nothing is fitted at it. If you book the consultation and fit in one visit instead, which takes three hours, you choose your hair system with your technician, who fits it, and you pay only once fitted; if you decide against it, you pay nothing. We confirm each visit on WhatsApp.",
        ],
      },
      {
        heading: "Prices and payment",
        paragraphs: [
          "Prices include GST, and are the ones shown before you pay. A visit you book in the app is paid when you book it, by UPI or card; a consultation and fit in one visit is paid once you are fitted. A first fit covers the hair system, the fitting and the cut. Your technician never handles money. We take no deposit and sell no package.",
        ],
      },
      {
        heading: "Moving and cancelling",
        paragraphs: [
          "You can move or cancel a visit in the app. Until the time the app shows when you book, that is free: your payment carries over to the new visit or is refunded, and a credit comes back. After that, the late terms the app shows before you confirm apply: the visit may be charged, a late fee kept, or a credit used. If we move a visit, it costs you nothing.",
          "If nobody is home when your technician arrives, the visit may be charged as a late cancellation would be, and you can dispute the charge in the app. A refund reaches the account you paid from in 5 to 7 working days.",
        ],
      },
      {
        heading: "The guarantee",
        paragraphs: [
          "If the fit is not right, we refit it at no charge, or refund you in full, including the fitting and the cut, within fourteen days of the fit. A hair system is bonded to the skin, so tell the technician about any skin condition, allergy or treatment before the fit; if a system is not suitable for you, we say so and do not fit it. A base wears with use and its life depends on its care, so the replacement intervals we give are typical, not promised.",
        ],
      },
      {
        heading: "The try-on",
        paragraphs: [
          // The try-on's sentence on WhatsApp is ADR 0104's.
          "The try-on is an illustrative simulation made by software from one photograph, and sent to the WhatsApp number you give, never shown on this site. It is not a photograph of a result, and not a promise of how your hair system will look: a hair system is matched to your own hair colour, density and growth pattern. Upload only a photograph of yourself, and only if you are eighteen or over. Each visitor gets one simulation.",
        ],
      },
      {
        heading: "Our responsibility",
        paragraphs: [
          "We are responsible for the care and skill of our technicians. Beyond a refit or refund under the guarantee, and except where the law provides otherwise, our liability for a visit is limited to what you paid for it. These terms are governed by the laws of India, and the courts at New Delhi have jurisdiction.",
        ],
      },
      {
        heading: "Questions and complaints",
        paragraphs: ["Message us on WhatsApp at {whatsapp}. Clients can also raise a concern in the app."],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------
