// How the readable copy of a client's data export (./my-data.ts) words what it stores as codes: each consent's purpose,
// and the codes that read badly spaced out. No design draws it; every word here is ours.

/** A consent's purpose, as the app's profile names it. */
export const PURPOSE_WORDS = {
  contact: "Contact about your booking",
  tryon_photo: "Your photograph, for a try-on",
  result_delivery: "Your try-on, sent on WhatsApp",
  photos_own_record: "Photographs taken for your visit record",
  photos_referral_cards: "Photographs on referral cards",
  photos_marketing: "Photographs in our marketing",
  whatsapp_visits: "WhatsApp about your visits",
  whatsapp_launches: "WhatsApp about launches",
} satisfies Readonly<Record<string, string>>;

/** Stored codes that read badly spaced out; every other code reads as its words. */
export const CODE_WORDS = {
  client: "You",
  ops: "Our team",
  system: "Automatically",
  care_team: "Mane Man Care",
  whatsapp_stop: "A STOP reply on WhatsApp",
  message_link: "The link in a message",
  app_share_sheet: "Sharing from the app",
  referral_landing: "An invite's page",
  site_waitlist: "The site's waitlist",
  try_on: "Try-on",
  lapsed: "Paid after the slot's hold ran out",
  not_movable: "The visit had begun, or its technician or time had changed, so it could not be moved",
  // A visit's status, as the client knew it.
  scheduled: "Booked",
  dispatched: "Booked",
  in_progress: "Under way",
  terminated: "Closed without a visit",
  // A booking started and let go before it was booked: a slot the app held while they chose.
  released: "Not booked",
} satisfies Readonly<Record<string, string>>;
