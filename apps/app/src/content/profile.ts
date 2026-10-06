// The profile (boards G1 and G2): the address, what the client has agreed to, and the account.

export const profile = {
  back: "Back",
  where: "Where we come",
  editAddress: "Edit address and access notes",
  // The design draws the profile with an address already given, and no form.
  noAddress: "No address yet. Add it before you book.",
  addAddress: "Add your address and access notes",
  // The design draws no landmark; the client types it as they like, so it shows as typed.
  landmark: "Landmark",
  // An address the client gave ops on the phone, which ops saved for them (ADR 0092).
  givenToOps: (date: string) =>
    `You gave us this address on the phone on ${date}. If anything is wrong, change it here.`,
  form: {
    // The design draws no address form at all, so none of the
    // building search's words are drawn either (ADR 0054). The search is an
    // addition to the form and never a gate: every field below still works
    // typed, and an address with no building chosen saves without a pin.
    building: {
      label: "Search for your building",
      hint: "Start typing your building or society. Choose it to help your technician find you.",
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
    line1: "Building, society or street",
    line2: "Street (optional)",
    locality: "Sector or area",
    city: "City",
    pincode: "Pincode",
    accessNotes: "Access notes (optional)",
    accessHint: "A gate code, or where to park. Your technician sees it the day before the visit.",
    save: "Save",
    cancel: "Cancel",
    invalid: "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
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
    // The design's profile lists four; the fifth is the waitlist's launch alert.
    whatsapp_launches: "WhatsApp about launches",
  },
  given: (date: string) => `Given ${date}`,
  notGiven: "Not given",
  // What switching off visit messages means, since ops then call instead.
  visitsOff: "No visit updates on WhatsApp. We’ll call you about any change.",
  // PLACEHOLDER until counsel rules what this switch means (docs/open-points.md, item 69): switched off, visits are
  // photographed all the same.
  ownRecordOff: "Each visit is still photographed for your visit record.",
  // A switch the API did not answer stays as it was.
  switchFailed: "That didn’t go through, so nothing has changed. Try again.",
  /**
   * The four lines the design shows before a card is turned on (F3), and the naming line the owner ruled beside
   * them; the consent's notice carries them all.
   */
  referralCards: {
    lines: [
      "Anyone you send this card to can see your photographs.",
      "They can forward it, and so can anyone who receives it.",
      "You can switch it off at any time, and new opens will show our house example instead.",
      "Cards already delivered stay in people’s chats. We cannot take those back.",
      // The owner's ruling: a referrer is named on their invite only after reading this (ADR 0025, item 24).
      "Your first name appears on your invite.",
    ],
    confirm: "Switch on",
    cancel: "Keep it off",
  },
  change: {
    label: "Change mobile number",
    body: "A code goes to both numbers, then we confirm with you before it takes effect.",
    prefix: "+91",
    placeholder: "New number",
    start: "Start the change",
    // Our words from here: the design draws the start only.
    invalid: "Enter a ten-digit mobile number, not the one you use now.",
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
  // The design has no card for where the client is signed in (docs/decisions/0029-sessions.md).
  sessions: {
    label: "Signed in on",
    thisDevice: "This device",
    unknown: "A browser",
    used: (date: string) => `Last used ${date}`,
    signOut: "Sign out",
    /** The button's name to a screen reader, which hears every row's "Sign out". */
    signOutOf: (device: string) => `Sign out ${device}`,
    signOutOthers: "Sign out everywhere else",
    failed: "That didn’t go through. Try again.",
  },
  support: {
    label: "Support",
    message: "Message us on WhatsApp",
    hint: "Replies within a working day. Everything in writing.",
  },
  // The design has no card for the client's rights over their data (docs/decisions/0049-dpdp.md).
  data: {
    label: "Your data",
    body: "Download a copy of everything we hold about you, or raise a concern about how we use it.",
    download: "Download my data",
    raise: "Raise a concern",
    field: "Your concern",
    send: "Send",
    cancel: "Not now",
    // Beside support's "Replies within a working day": the 30 days is the most a concern can take, not the usual.
    sent: "Received. We reply here and on WhatsApp, usually within a working day and within 30 days at the latest.",
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
    body: "Deleted within 30 days of your request. Invoices kept eight years, by law.",
    request: "Request deletion",
    // The design draws the button only.
    confirm: "Ask us to delete your account? We’ll confirm on WhatsApp before anything is deleted.",
    yes: "Yes, request deletion",
    no: "Keep my account",
    requested: (date: string) => `Deletion requested on ${date}. We’ll confirm on WhatsApp.`,
    failed: "That didn’t go through, so nothing was requested. Try again.",
    // A request ops rejected, shown for 30 days with their reason, which is their own words.
    rejected: (date: string) => `On ${date} we didn’t delete your account.`,
    why: (reason: string) => `Our reason: ${reason}`,
    disagree: "Message us if you disagree, or ask again.",
  },
  // The design has no logout; it ends the session on this device.
  logout: "Sign out",
  // Only the API can end the session, so a logout it did not answer leaves the client logged in.
  logoutFailed: "That didn’t go through, so you’re still signed in here. Try again.",
} as const;
