// Photos (design/client-redesign, the photos screen): the client's own record, before and after at its top.

export const photos = {
  title: "Photos",
  /** The before and after, as a screen reader names it, and its angles. */
  compare: "Before and after",
  angle: "Angle",
  angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hairline" },
  private: "Only you and your technician see these.",
  everyVisit: "Every visit",
  count: (photographs: number) => (photographs === 1 ? "1 photo" : `${String(photographs)} photos`),
  // A photo's description for a screen reader.
  alt: (angle: string, phase: "before" | "after", date: string) => `${angle}, ${phase} the visit, ${date}`,
  from: "Before",
  to: "After",
  // The divider's name for a screen reader, and what its place shows.
  divider: "Drag to compare before and after",
  dividerAt: (percent: number, from: string, to: string) =>
    `${String(percent)}% of ${from} on the left, ${String(100 - percent)}% of ${to} on the right`,
  download: "Download",
  downloaded: "Saved to your phone’s photos.",
  photoOf: (angle: string, date: string) => `${angle} · ${date}`,
  close: "Close",
  /** A photograph whose link would not load, in its place in a row; a tap reads fresh links. */
  reload: "Tap to reload",
  notLoaded: (alt: string) => `${alt}, not loaded. Tap to reload.`,
  /** The large photograph that would not load. */
  largeFailed: "This photo didn’t load.",
  reloadPhotos: "Reload photos",
  // The try-on the client made on the site (ADR 0025, items 63 and 65; ADR 0082 and 0084).
  tryOn: {
    title: "Your try-on",
    images: { photo: "Your photo", look: "Your look" },
    alt: (image: string, date: string) => `${image}, try-on of ${date}`,
    // How long each is kept: the photograph an hour after the look was asked for, the look the days the site keeps it.
    keptBoth: (photoUntil: string, lookUntil: string) =>
      `Your photo is kept until ${photoUntil}, the look until ${lookUntil}.`,
    keptLook: (lookUntil: string) =>
      `Your full-size photo was deleted within the hour. The look is kept until ${lookUntil}.`,
    keptPhoto: (photoUntil: string) => `The look is still being made. Your photo is kept until ${photoUntil}.`,
    // The small copy of the photograph is held as long as the look, until the client books (ADR 0084).
    keptTogether: (until: string) => `Your photo and the look are kept until ${until}.`,
    // A client's try-on, once they have booked: the photograph for good, the look until the first fit.
    photoKept: "Your photo is kept in your account until you ask us to delete it.",
    lookKeptToFirstFit: "The look is kept until the photos of your first fit are taken.",
    lookKeptUntil: (lookUntil: string) => `The look is kept until ${lookUntil}.`,
  },
} as const;
