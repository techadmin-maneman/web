// The widths a layout changes at: one list for every surface. A stylesheet writes one of these conditions as it is,
// since a media condition takes no custom property, and test/node/packages/brand-breakpoints.test.ts holds every
// stylesheet to the list; a script reads the same condition here for matchMedia.

export const MEDIA = {
  /** A phone held upright. */
  phone: "(max-width: 600px)",
  /** A phone, or a narrow window: the site's one-column layouts. */
  narrow: "(max-width: 760px)",
  /** Anything wider than narrow. */
  beyondNarrow: "(min-width: 761px)",
  /** A laptop or wider: the two-column pages, the console's tray beside its grid. */
  wide: "(min-width: 1024px)",
  /** Anything short of wide. */
  belowWide: "(max-width: 1023px)",
} as const;
