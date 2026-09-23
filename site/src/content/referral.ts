// The referral landing at /r/:code, word for word from the design
// (design/phase2/Referral and Waitlist, boards C1 to C5).
//
// The prices repeat the site's own (site.ts), because the design's open
// question rules that a referred friend sees the same figures. The referrer's
// name is filled in where {name} appears; without a name the page says "You
// have an invite" instead.

import { fill } from "../lib/text.ts";

export const referral = {
  city: "Gurgaon",
  /** The navy block at the top, before the pincode is known (C1). */
  arrival: {
    invited: "{name} sent you this",
    unnamed: "You have an invite",
    title: "Hair, fitted at your home in Gurgaon.",
    offer: "Get fitted and you both get 3 service visits free.",
    /**
     * A code we do not know: a typo, a revoked code, or one more than 12 months
     * old (board C4, "Code expired"). The API does not say which, so the page
     * says only what is true of all three.
     */
    unknown: {
      title: "We do not recognise this invite",
      body: "The consultation is still free; the 3 service visits do not apply.",
    },
  },
  prices: {
    rows: [
      {
        what: "First fit, from",
        note: "Standard base",
        amount: "₹25,000",
        incl: "The piece, the fitting and the cut",
      },
      {
        what: "Service visit",
        note: "Every four weeks, at home",
        amount: "₹1,500",
        incl: "Lifted, cleaned, re-bonded, trimmed",
      },
    ],
  },
  howItWorks: {
    title: "How it works",
    steps: [
      { n: "1", title: "A free consultation at home", body: "Forty minutes. A scalp template and a colour match." },
      { n: "2", title: "The fit, also at home", body: "Three hours. You leave the house wearing it." },
      { n: "3", title: "A service visit every four weeks", body: "Lifted, cleaned, re-bonded, trimmed. An hour." },
    ],
  },
  /** The pincode check, which decides whether the page books or takes a number (C1, C2, C3). */
  pincode: {
    title: "Do we come to you?",
    label: "Pincode",
    placeholder: "122018",
    check: "Check",
    checking: "Checking",
    invalid: "That is not a six-digit Indian pincode.",
    failed: "We could not check that just now. Try again.",
  },
  /** The consultation form, shown when the pincode is served (C2). */
  consultation: {
    served: "We come to {area}",
    title: "Book a free consultation",
    body: "Forty minutes. Nothing fitted, nothing to pay.",
    date: "Pick a date",
    window: "Window",
    windows: [
      { id: "morning", label: "Morning", hours: "9 am to 12 pm" },
      { id: "afternoon", label: "Afternoon", hours: "12 to 4 pm" },
      { id: "evening", label: "Evening", hours: "4 to 8 pm" },
    ],
    /** Recorded as the consultation's notice, word for word (src/config/notices.ts, referral-consultation-v1). */
    consent: "You may contact me on WhatsApp about this consultation.",
    submit: "Book the consultation",
    sending: "Booking",
    told: "{name} is told when you are fitted. That is when the 3 visits land.",
    toldUnnamed: "Whoever invited you is told when you are fitted. That is when the 3 visits land.",
  },
  /** The waitlist form, shown when the pincode is not served (C3). */
  waitlist: {
    title: "We are not in {area} yet",
    titleUnknown: "We are not there yet",
    body: "Gurgaon only, for now.",
    leave: "Leave us your number",
    forPincode: "For {pincode}{area}.",
    contactConsent: "You may contact me about this request.",
    required: "Required",
    launchAlert: "Tell me when you launch in my area.",
    optional: "Optional",
    submit: "Add me to the list",
    sending: "Adding",
    holds: "{name}’s invite stays valid for 12 months after we launch there.",
    holdsUnnamed: "The invite stays valid for 12 months after we launch there.",
  },
  /** Shared between the two forms. */
  form: {
    name: "Name",
    namePlaceholder: "Your name",
    nameError: "Please tell us your name.",
    mobile: "Mobile",
    mobilePlaceholder: "Your number",
    mobileError: "Please enter a ten-digit mobile number.",
    consentError: "We need this to contact you.",
  },
  /** What each answer says (C4). */
  booked: {
    label: "Consultation booked",
    body: "A technician messages you the day before.",
    free: "free",
    credits: "The 3 service visits land when you are fitted.",
    back: "See the site",
  },
  listed: {
    label: "On the list",
    title: "You are on the {area} list",
    titleUnknown: "You are on the list",
    body: "We message you when a technician starts working there.",
    creditsFrom: "{name}’s invite holds for 12 months after that.",
    credits: "The invite holds for 12 months after that.",
    tryOn: "See yourself with hair",
    back: "See the site",
  },
  errors: {
    rateLimited: "That is a few too many tries. Please try again tomorrow.",
    turnstile: "We could not confirm you are a person. Please try again.",
    taken: "That window has just gone. Please pick another.",
    opsAssisted: "Booking goes through WhatsApp for now. Message us and we will fix a time.",
    notBookable: "That day is no longer open. Please pick another.",
    other: "Something went wrong at our end. Please try again.",
  },
  page: {
    title: "Your Mane Man invite",
    description: "Home-fitted hair systems in Gurgaon. 3 service visits free when you are fitted.",
  },
};

/** The title a shared invite carries, which the mm-site Worker writes into the preview. */
export function inviteTitle(name: string | null): string {
  return name === null ? "You have a Mane Man invite" : fill("{name} sent you a Mane Man invite", { name });
}
