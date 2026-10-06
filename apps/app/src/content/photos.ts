// Photos (board D): the client's own record, and the compare.

export const photos = {
  title: "Photos",
  /** Why the visits' photographs are kept, said above them. */
  basis: "Taken for your visit record.",
  compare: "Compare",
  angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
  /** The compare's three angles, as the compare names them. */
  compareAngles: { front: "Front", top: "Top", hair: "Hairline" },
  // A photograph's description for a screen reader; the design draws no captions.
  alt: (angle: string, phase: "before" | "after", date: string) => `${angle}, ${phase} the visit, ${date}`,
  back: "Back to photos",
  from: "From",
  to: "To",
  // The divider's name for a screen reader, what its place shows, and the compare opened with fewer
  // than two visits.
  divider: "Divider between the two photos",
  dividerAt: (percent: number, from: string, to: string) =>
    `${String(percent)}% of ${from} on the left, ${String(100 - percent)}% of ${to} on the right`,
  compareNone: "Compare opens once two visits have photos.",
  download: "Download",
  downloaded: "Downloaded photos sit in your gallery, outside the app.",
  photoOf: (angle: string, date: string) => `${angle} · ${date}`,
  close: "Close",
  // No board draws the try-on the client made on the site (ADR 0025, items 63 and 65; ADR 0082 and 0084).
  tryOn: {
    title: "Your try-on",
    images: { photo: "Your photo", look: "Your look" },
    alt: (image: string, date: string) => `${image}, try-on of ${date}`,
    // How long each is kept: the photograph an hour after the look was asked for, the look the days the site keeps it.
    keptBoth: (photoUntil: string, lookUntil: string) =>
      `Your photo is kept until ${photoUntil}, the look until ${lookUntil}.`,
    keptLook: (lookUntil: string) => `Your photo was deleted within the hour. The look is kept until ${lookUntil}.`,
    keptPhoto: (photoUntil: string) => `The look is still being made. Your photo is kept until ${photoUntil}.`,
    // The small copy of the photograph is held as long as the look, until the client books (ADR 0084).
    keptTogether: (until: string) => `Your photo and the look are kept until ${until}.`,
    // A client's try-on, once they have booked (ADR 0084): the photograph for good, the look until the first fit.
    photoKept: "Your photo is kept in your account until you ask us to delete it.",
    lookKeptToFirstFit: "The look is kept until your first fit is photographed.",
    lookKeptUntil: (lookUntil: string) => `The look is kept until ${lookUntil}.`,
  },
} as const;
