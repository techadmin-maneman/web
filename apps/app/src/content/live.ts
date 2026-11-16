// The visit day on Home's card (design/client-redesign, the live card): where the visit stands, from the technician's
// word to the step under way, and the client's sign-off of a fit, in their own app only
// (docs/decisions/0254-client-signs-off-the-fit.md).

export const live = {
  today: "Today",
  /** Where no technician has the visit yet. */
  yourTechnician: "Your technician",
  /** "Service visit today". */
  visitToday: (what: string) => `${what} today`,
  setsOff: (technician: string) => `You’ll get a message here and on WhatsApp when ${technician} sets off.`,
  onTheWay: (technician: string) => `${technician} is on the way`,
  runningLate: (technician: string) => `${technician} is running late`,
  atTheGate: (technician: string) => `${technician} is at the gate`,
  atTheDoor: (technician: string) => `${technician} is at your door`,
  arrivingAround: (time: string) => `Arriving around ${time}`,
  /** The technician's word as they gave it, beneath. */
  said: "Also sent to you on WhatsApp",
  waits: (until: string) => `They wait until ${until}. If nobody answers, the visit is marked missed.`,
  inProgress: "Visit in progress",
  /** "Step 2 of 5: Hair system". */
  step: (index: number, of: number, name: string) => `Step ${String(index)} of ${String(of)}: ${name}`,
  steps: {
    before_photos: "Before photos",
    service: "Service",
    scalp: "Scalp and hairline",
    hair_profile: "Hair profile",
    hair_system: "Hair system",
    fitting: "Fitting",
    after_photos: "After photos",
    sign_off: "Your sign-off",
  },
  updates: (technician: string) => `Updates as ${technician} completes each step in their app.`,
  track: ["Confirmed", "On the way", "Arrived", "Visit", "Done"] as const,
  done: "Visit done",
  doneLine: "Your photos are in.",
  seePhotos: "See photos and the visit",
  /** The client's sign-off of a fit. */
  signOff: {
    title: "Your sign-off",
    check: (technician: string) => `Check the fit before ${technician} leaves`,
    photos: "See today’s after photos",
    checks: {
      hairline: "The hairline sits where we agreed",
      blend: "The colour and the blend look right",
      secure: "It feels secure and comfortable",
    },
    happy: "I’m happy with the fit",
    notRight: "Something isn’t right",
    whatsWrong: "What isn’t right?",
    send: (technician: string) => `Send to ${technician}`,
    cancel: "Back",
    sent: (technician: string) => `Sent to ${technician}`,
    sentLine: (technician: string) =>
      `${technician} sees it on their phone now and puts it right before they go, then asks you to sign off again.`,
    signed: (time: string) => `Signed off by you, ${time}`,
    guarantee: (days: number) =>
      `Signing off doesn’t end your guarantee: if the fit isn’t right, tell us within ${String(days)} days of today and we refit it free or refund you in full.`,
    recorded: "Signing off records that you saw the fit before the technician left.",
    failed: "That didn’t go through. Try again.",
  },
} as const;
