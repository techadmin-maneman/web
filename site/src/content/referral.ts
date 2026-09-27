// The referral landing at /r/:code, word for word from the design
// (design/phase2/Referral and Waitlist, boards C1 to C5), except where we go
// and how long each visit takes, which are the site's own (service.ts).
//
// The prices are the site's own, from the price book (src/lib/prices.ts),
// because the design's open question rules that a referred friend sees the
// same figures. The referrer's name is filled in where {name} appears; without
// a name the page says "You have an invite" instead.

import type { Invite } from "../lib/api.ts";
import { fill } from "../lib/text.ts";
import { capitalised, serviceArea, visitLength } from "./service.ts";
import { notices, type Notice } from "./site.ts";

/** A one-line notice's words, as the backend records them with the consent (src/config/notices.ts). */
function lineOf(notice: Notice): string {
  const [line = ""] = notice.lines;
  return line;
}

export const referral = {
  /** The navy block at the top, before the pincode is known (C1). The design's "in Gurgaon" is the site's area. */
  arrival: {
    invited: "{name} sent you this",
    unnamed: "You have an invite",
    title: `Hair, fitted at your home across ${serviceArea}.`,
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
        amount: "{firstFit}",
        incl: "The piece, the fitting and the cut",
      },
      {
        what: "Service visit",
        note: "Every four weeks, at home",
        amount: "{service}",
        incl: "Lifted, cleaned, re-bonded, trimmed",
      },
    ],
  },
  howItWorks: {
    title: "How it works",
    // The lengths are the backend's (service.ts), where the design wrote forty minutes and an hour.
    steps: [
      {
        n: "1",
        title: "A free consultation at home",
        body: `${capitalised(visitLength.consultation)}. A scalp template and a colour match.`,
      },
      {
        n: "2",
        title: "The fit, also at home",
        body: `${capitalised(visitLength.firstFit)}. You leave the house wearing it.`,
      },
      {
        n: "3",
        title: "A service visit every four weeks",
        body: `Lifted, cleaned, re-bonded, trimmed. ${capitalised(visitLength.service)}.`,
      },
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
    // Not drawn: a pincode typed wrong could only be put right by reloading the page. The owner approves the words (open point 45).
    change: "Change",
    changeLabel: "Change the pincode",
  },
  /** The consultation form, shown when the pincode is served (C2). */
  consultation: {
    served: "We come to {area}",
    title: "Book a free consultation",
    body: `${capitalised(visitLength.consultation)}. Nothing fitted, nothing to pay.`,
    forPincode: "For {pincode}",
    date: "Pick a date",
    window: "Window",
    windows: [
      { id: "morning", label: "Morning", hours: "9 am to 12 pm" },
      { id: "afternoon", label: "Afternoon", hours: "12 to 4 pm" },
      { id: "evening", label: "Evening", hours: "4 to 8 pm" },
    ],
    consent: lineOf(notices.consultation),
    submit: "Book the consultation",
    sending: "Booking",
    told: "{name} is told when you are fitted. That is when the 3 visits land.",
    toldUnnamed: "Whoever invited you is told when you are fitted. That is when the 3 visits land.",
  },
  /**
   * Not drawn: no board puts an address on the consultation form. The owner ruled on 27 September 2026 that the
   * site takes the full address before a consultation is booked (ADR 0025, item 62; ADR 0081), so the fields and
   * their words are the client app's own (apps/app/src/content.ts, `profile.form`). The owner approves the words
   * (open point 45).
   */
  address: {
    legend: "Where we come",
    labels: {
      flat: "Flat or house number",
      floor: "Floor (optional)",
      tower: "Tower or block (optional)",
      line1: "Building, society or street",
      line2: "Street (optional)",
      landmark: "Landmark (optional)",
      locality: "Sector or area",
      city: "City",
      accessNotes: "Access notes (optional)",
    },
    errors: {
      line1: "Please give the building, society or street.",
      locality: "Please give the sector or area.",
      city: "Please give the city.",
    },
    pincode: "Pincode",
    accessHint: "A gate code, or where to park. Your technician sees it the day before the visit.",
  },
  /** The waitlist form, shown when the pincode is not served (C3). */
  waitlist: {
    title: "We are not in {area} yet",
    titleUnknown: "We are not there yet",
    body: `${serviceArea} only, for now.`,
    leave: "Leave us your number",
    forPincode: "For {pincode}{area}",
    contactConsent: lineOf(notices.waitlist),
    required: "Required",
    launchAlert: lineOf(notices.launchAlert),
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
    // Not drawn on C4 (docs/fidelity-method.md, "The referral landing"). The owner approves the words (open point 45).
    number: "On WhatsApp to +91 {mobile}",
    // Not drawn: the number already had an address, which the booking kept rather than the one typed (ADR 0081). It
    // names no part of that address, since whoever typed the number may not be its owner. The owner approves the
    // words (open point 45).
    addressOnAccount:
      "We come to the address already on your account, not the one given here. To change it, message us on WhatsApp.",
    calendar: "Add to calendar",
    calendarFile: "mane-man-consultation.ics",
    calendarTitle: "Mane Man consultation",
    app: "See it in the app",
  },
  /**
   * C4's "Code expired" frame. The invite has lapsed for this friend only, which the API can tell once they have
   * given their number, so the frame shows with the booking's answer rather than before it (ADR 0025, item 40).
   */
  expired: {
    label: "Code expired",
    title: "This invite has expired",
    body: "More than 12 months old. The consultation is still free; the 3 visits do not apply.",
  },
  /**
   * C4's frame again, for a consultation nobody could book outright: self-serve
   * booking is off, so ops fix the hour on WhatsApp
   * (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
   */
  requested: {
    label: "Consultation requested",
    body: "We message you on WhatsApp to fix the hour.",
    asked: "You asked for",
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
    notBookable: "That day is no longer open. Please pick another.",
    other: "Something went wrong at our end. Please try again.",
    // Not drawn: the number already has a consultation to come (ADR 0025, item 41). The owner approves the words (open point 45).
    alreadyBooked: "This number already has a consultation, {when}. To change it, message us on WhatsApp.",
  },
  /**
   * What a shared invite's preview says (boards B1 and B2), which the mm-site Worker writes into the page. Only a
   * valid invite promises the visits: any other books without them.
   */
  preview: {
    title: "{name} sent you a Mane Man invite",
    titleUnnamed: "You have a Mane Man invite",
    description: `Home-fitted hair systems across ${serviceArea}. 3 service visits free when you're fitted.`,
    descriptionWithout: `Home-fitted hair systems across ${serviceArea}.`,
  },
};

/** The title a shared invite carries. */
export function inviteTitle(name: string | null): string {
  return name === null ? referral.preview.titleUnnamed : fill(referral.preview.title, { name });
}

/** The preview's description: the visits only for an invite that carries them, never for one we could not read. */
export function inviteDescription(invite: Invite | null): string {
  return invite?.state === "valid" ? referral.preview.description : referral.preview.descriptionWithout;
}
