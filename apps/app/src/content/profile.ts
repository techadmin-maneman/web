// The profile: the address, what the client has agreed to, and the account.

import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { timeOfDay, UNBROKEN } from "@rules/lib/time-range.ts";

/** What every visit's photographs are. */
export const VISIT_PHOTOS =
  "Photos at every visit: five angles, for your record. Only you and your technician see them.";

export const profile = {
  back: "Back",
  where: "Your address",
  editAddress: "Edit address and access notes",
  noAddress: "No address yet. Add it so your technician can find you.",
  addAddress: "Add your address and access notes",
  // The client types the landmark as they like, so it shows as typed.
  landmark: "Landmark",
  // An address the client gave ops on the phone, which ops saved for them (ADR 0092).
  givenToOps: (date: string) => `You gave us this address by phone on ${date}. Change it if anything’s wrong.`,
  form: {
    // The building search (ADR 0054) is an addition to the form and never a gate: every field below still works
    // typed, and an address with no building chosen saves without a pin.
    building: {
      label: "Search for your building",
      hint: "Search for your building or society, so your technician can find you.",
      unavailable: "Search isn’t available right now. Type your address below instead.",
      found: (count: number) => (count === 1 ? "1 building found" : `${String(count)} buildings found`),
      // Google asks for their name against suggestions shown without a map.
      attribution: "Google Maps",
    },
    flat: "Flat or house number",
    floor: "Floor (optional)",
    tower: "Tower or block (optional)",
    landmark: "Landmark (optional)",
    // The flat is asked for on its own above, so this line is the building or the street the house is on.
    line1: CLIENT_WORDS.addressLine,
    line2: "Street (optional)",
    locality: "Sector or area",
    city: "City",
    pincode: "Pincode",
    accessNotes: "Access notes (optional)",
    accessHint: CLIENT_WORDS.accessHint,
    save: "Save",
    cancel: "Cancel",
    invalid: "Add your flat or house number, building or street, area, city and 6-digit pincode.",
    // A pincode we do not come to, and a move to another city while a visit is booked.
    notServed: (pincode: string) => `We don’t come to ${pincode} yet.`,
    waitlist: "Join the waitlist",
    visitBooked: "You have a visit booked in this city. To move to another, message us first.",
    message: "Message us",
  },
  agreed: "What you have agreed to",
  purposes: {
    photos_own_record: "Photographs taken for your visit record",
    photos_referral_cards: "Photographs on referral cards",
    photos_marketing: "Photographs in our marketing",
    whatsapp_visits: "WhatsApp about your visits",
    // The waitlist's launch alert, beside the four consents.
    whatsapp_launches: "WhatsApp about launches",
  },
  given: (date: string) => `Given ${date}`,
  // What switching off visit messages means, since ops then call instead.
  visitsOff: "No visit updates on WhatsApp. We’ll call you about any change.",
  // Every visit is photographed for the client's record, so there is no switch for it, only this line.
  visitPhotos: VISIT_PHOTOS,
  // A switch the API did not answer stays as it was.
  switchFailed: "Couldn’t save that. Try again.",
  /**
   * The line shown before a card is turned on, as its notice says it, which names the referrer on their invite
   * (ADR 0025, item 24); its link opens the rest of the notice.
   */
  referralCards: {
    line: "Your before and after goes on the card your friends see, with your first name.",
    confirm: "Switch on",
    cancel: "Keep it off",
  },
  change: {
    label: "Change mobile number",
    body: "We’ll send a code to both numbers, then confirm with you.",
    prefix: "+91",
    placeholder: "New number",
    /** The box's name to a screen reader, which shows none. */
    newNumber: "New mobile number",
    start: "Start the change",
    invalid: "Enter a 10-digit mobile number, not the one you use now.",
    codes: "Enter the code sent to each number.",
    oldCode: "Code sent to your current number",
    newCode: (number: string) => `Code sent to ${number}`,
    check: "Check the codes",
    proven: "Code accepted.",
    waiting: (number: string) => `We’ll confirm the change to ${number} with you, then it takes effect.`,
    withdraw: "Withdraw this change",
    failed: "That didn’t go through. Try again.",
    limited: "You’ve started three changes today. Try again tomorrow.",
    // What ops decided about the last change, for 30 days after. The reason is ops' own words.
    confirmed: (number: string, date: string) => `Your number was changed to ${number} on ${date}.`,
    rejected: (number: string, date: string) => `On ${date} we didn’t change your number to ${number}.`,
    why: (reason: string) => `Our reason: ${reason}`,
  },
  // Where the client is signed in (docs/decisions/0029-sessions.md).
  sessions: {
    label: "Signed in on",
    thisDevice: "This device",
    unknown: "A browser",
    used: (date: string) => `Last used ${date}`,
    signOut: "Sign out",
    /** The button's name to a screen reader, which hears every row's "Sign out". */
    signOutOf: (device: string) => `Sign out ${device}`,
    signOutOthers: "Sign out everywhere else",
    /** Asked before every other device is signed out, which cannot be undone. */
    confirmOthers: "Sign out of every other device?",
    yes: "Sign out",
    no: "Keep them",
    failed: "That didn’t go through. Try again.",
    notLoaded: "Where you’re signed in didn’t load.",
  },
  support: {
    label: "Support",
    message: "Message us on WhatsApp",
    /** "We reply within an hour, 9 am–9 pm daily." */
    hint: (within: string, hours: string) => `We reply within ${within}, ${hours} daily.`,
    /** How soon Care answer, as the card says it: "an hour", "2 hours", "30 minutes". */
    within: (minutes: number) => {
      if (minutes === 60) return "an hour";
      if (minutes % 60 === 0) return `${String(minutes / 60)} hours`;
      return `${String(minutes)} minutes`;
    },
    /** Their named Care person: "Asha, your Care person". */
    carePerson: (name: string) => `${name}, your Care person`,
    /** "9 am–9 pm" */
    hours: (opens: string, closes: string) => `${opens}–${closes}`,
    /** An hour of the day as the card says it: "9 am", "12 noon", "9 pm". */
    hour: (hour: number) => timeOfDay(`${String(hour).padStart(2, "0")}:00`, UNBROKEN),
  },
  // The client's rights over their data (docs/decisions/0049-dpdp.md).
  data: {
    label: "Your data",
    body: "Download your data, or raise a concern about how we use it.",
    download: "Download my data",
    raise: "Raise a concern",
    field: "Your concern",
    send: "Send",
    cancel: "Not now",
    // Beside support's "Replies the same day": the 30 days is the most a concern can take, not the usual.
    sent: "Received. We’ll reply here and on WhatsApp, usually the same day and always within 30 days.",
    failed: "That didn’t go through. Try again.",
    limited: "You’ve reached today’s limit. Send it tomorrow, or message us on WhatsApp.",
    // The client's latest concerns, each with our answer once given.
    concerns: "Your concerns",
    concern: (date: string, status: string) => `Your concern of ${date} · ${status}`,
    waiting: "Awaiting our reply",
    answered: (date: string) => `Answered ${date}`,
    answer: (response: string) => `Our answer: ${response}`,
  },
  deletion: {
    label: "Delete your account",
    body: "We act on your request within 30 days. Bookings and payments are settled first, and invoices are kept for 8 years, as the law requires.",
    request: "Request deletion",
    confirm: "Ask us to delete your account? We’ll confirm on WhatsApp before anything is deleted.",
    yes: "Yes, request deletion",
    no: "Keep my account",
    requested: (date: string) => `Deletion requested on ${date}. We’ll confirm on WhatsApp.`,
    failed: "Couldn’t send your request. Try again.",
    // A request ops rejected, shown for 30 days with their reason, which is their own words.
    rejected: (date: string) => `On ${date} we didn’t delete your account.`,
    why: (reason: string) => `Our reason: ${reason}`,
    disagree: "Message us if you disagree, or ask again.",
  },
  // Signing out ends the session on this device.
  logout: "Sign out",
  // Only the API can end the session, so a logout it did not answer leaves the client logged in.
  logoutFailed: "Couldn’t sign you out. Try again.",
} as const;
