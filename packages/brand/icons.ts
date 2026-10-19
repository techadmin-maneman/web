// The design's line icons, as path data in a 24 × 24 box, drawn with round caps at one of two strokes and one of
// five sizes. They are drawn in currentColor, so a component sets their colour through CSS. Every glyph a surface
// draws is here.

/** The sizes an icon is drawn at, in pixels: a surface names one, and never a number of its own. */
export const ICON_SIZES = { xs: 14, sm: 18, md: 21, lg: 24, xl: 28 } as const;
export type IconSize = keyof typeof ICON_SIZES;

/** The set's stroke, and the heavier one the technician app draws for reading in the sun. */
export const ICON_STROKES = { regular: 1.6, heavy: 2 } as const;
export type IconWeight = keyof typeof ICON_STROKES;

/** The stroke the icon set is drawn at. */
export const ICON_STROKE = ICON_STROKES.regular;

/** The site's first icons. Frozen: the site's island bundles carry exactly these. */
export const ICONS = {
  tick: "M4 12.5 L9.5 18 L20 6",
  cross: "M6 6 L18 18 M18 6 L6 18",
  back: "M15 5 L8 12 L15 19",
  handleLeft: "M14 8 L10 12 L14 16",
  handleRight: "M10 8 L14 12 L10 16",
  plus: "M12 6 V18 M6 12 H18",
  minus: "M6 12 H18",
  selectArrow: "M6 10 L12 16 L18 10",
  download: "M12 4 V15 M7.5 10.5 L12 15 L16.5 10.5 M5 19 H19",
  whatsapp:
    "M20 11.5 C20 16.2 16.2 20 11.5 20 C9.9 20 8.4 19.6 7.2 18.8 L3.5 19.5 L4.3 15.9 C3.5 14.6 3 13.1 3 11.5 C3 6.8 6.8 3 11.5 3 C16.2 3 20 6.8 20 11.5 Z M8.8 8.2 C8.4 9.2 9 10.6 10 11.8 C11 13 12.4 13.8 13.4 13.6 L14.6 12.4 L13 11.2 L12 12 C11.4 11.6 10.6 10.8 10.2 10 L11 9 L9.8 7.6 Z",
  noPhoto:
    "M3.5 8 H7 L8.5 5.5 H15.5 L17 8 H20.5 V19 H3.5 Z M12 9.7 A3.8 3.8 0 0 1 12 17.3 A3.8 3.8 0 0 1 12 9.7 M4 4 L20 20",
  sending: "M12 3.5 A8.5 8.5 0 0 1 20.5 12",
} as const;

/** The company's pages elsewhere, in the site's footer, drawn in the set's own line. */
export const SOCIAL_ICONS = {
  linkedin:
    "M7 3.5 H17 A3.5 3.5 0 0 1 20.5 7 V17 A3.5 3.5 0 0 1 17 20.5 H7 A3.5 3.5 0 0 1 3.5 17 V7 A3.5 3.5 0 0 1 7 3.5 Z M8 10.5 V16.5 M8 7.7 V7.8 M11.5 16.5 V10.5 M11.5 13.2 C11.5 11.4 12.6 10.4 14 10.4 C15.4 10.4 16.5 11.4 16.5 13.2 V16.5",
  instagram:
    "M7 3.5 H17 A3.5 3.5 0 0 1 20.5 7 V17 A3.5 3.5 0 0 1 17 20.5 H7 A3.5 3.5 0 0 1 3.5 17 V7 A3.5 3.5 0 0 1 7 3.5 Z M12 8 A4 4 0 0 1 12 16 A4 4 0 0 1 12 8 M17 6.9 V7",
} as const;

/** The nine glyphs the apps add (design/phase2/Client App.dc.html, the icons board). */
export const APP_ICONS = {
  visitCredit: "M12 3.5 A8.5 8.5 0 0 1 12 20.5 A8.5 8.5 0 0 1 12 3.5 M8 12 L11 15 L16.5 9",
  holdTimer: "M9 3 H15 M12 3 V7 M12 7 A6.5 6.5 0 0 1 12 20 A6.5 6.5 0 0 1 12 7 M12 11 V14",
  compare: "M12 4 V20 M4.5 8 H9 V16 H4.5 Z M15 8 H19.5 V16 H15 Z",
  taxDocument: "M6 3.5 H14 L18 7.5 V20.5 H6 Z M14 3.5 V7.5 H18 M9 12 H15 M9 16 H13",
  share: "M12 15 V4 M8 8 L12 4 L16 8 M5 14 V20 H19 V14",
  referral:
    "M9 8 A2.5 2.5 0 0 1 9 13 A2.5 2.5 0 0 1 9 8 M4 20 C4 16.6 6.2 15 9 15 C11.8 15 14 16.6 14 20 M16 6 L18 8 L16 10 M18 8 H13.5",
  offline: "M4 8 C9 4 15 4 20 8 M7.5 12 C10.5 9.8 13.5 9.8 16.5 12 M12 16.5 V16.6 M3 3 L21 21",
  uploadQueue: "M12 14 V5 M8.5 8.5 L12 5 L15.5 8.5 M4.5 15 V19.5 H19.5 V15 M8 17.2 H16",
  pieceId: "M4 6 V18 M7 7 V17 M10 7 V17 M13.5 7 V17 M17 7 V17 M20 6 V18",
} as const;

/**
 * The glyphs the apps draw beyond the two sets, each declared once here
 * rather than once in each app. An app's own icons.ts keeps only
 * the glyphs no other app draws.
 */
export const GLYPHS = {
  /** A row that opens its detail: a past visit in the client app, a job in the technician app. */
  chevron: "M9 5 L16 12 L9 19",
  /** Beside the client app's "Read automatically": the WhatsApp glyph's bubble without its handset. */
  bubble:
    "M20 11.5 C20 16.2 16.2 20 11.5 20 C9.9 20 8.4 19.6 7.2 18.8 L3.5 19.5 L4.3 15.9 C3.5 14.6 3 13.1 3 11.5 C3 6.8 6.8 3 11.5 3 C16.2 3 20 6.8 20 11.5 Z",
  /** Beside the pay step's "Slot held": a clock face. */
  clock: "M12 3.5 A8.5 8.5 0 0 1 12 20.5 A8.5 8.5 0 0 1 12 3.5 M12 7.5 V12 L15 14.5",
  /** A referral card's two other ways to share: to another app, and by copying the link. */
  otherApps:
    "M8 7 H6 A2 2 0 0 0 4 9 V18 A2 2 0 0 0 6 20 H18 A2 2 0 0 0 20 18 V9 A2 2 0 0 0 18 7 H16 M12 3 V13 M8.5 6.5 L12 3 L15.5 6.5",
  copyLink: "M9.5 13.5 L14.5 8.5 M8 11 L6 13 A3.5 3.5 0 0 0 11 18 L13 16 M11 8 L13 6 A3.5 3.5 0 0 1 18 11 L16 13",
  /** A label tied to a piece, beside the field it is typed in: typed, never scanned, so no barcode. */
  tag: "M3.5 3.5 H12 L20.5 12 L12 20.5 L3.5 12 Z M8 6.8 A1.2 1.2 0 0 1 8 9.2 A1.2 1.2 0 0 1 8 6.8",
  /** Navigate, on the address. */
  pin: "M12 21 C7 16 4.5 12.6 4.5 9.5 A7.5 7.5 0 0 1 19.5 9.5 C19.5 12.6 17 16 12 21 Z M12 7 A2.6 2.6 0 0 1 12 12.2 A2.6 2.6 0 0 1 12 7",
  /** The ops console's navigation, an entry each, and its search, its menu and its fold. */
  tasks:
    "M10 6.5 H20 M10 12 H20 M10 17.5 H20 M4 6.5 L5.2 7.7 L7.2 5.3 M4 12 L5.2 13.2 L7.2 10.8 M4 17.5 L5.2 18.7 L7.2 16.3",
  board: "M3.5 4.5 H20.5 V19.5 H3.5 Z M3.5 9.5 H20.5 M9 9.5 V19.5 M14.5 9.5 V19.5",
  person: "M12 4 A4 4 0 0 1 12 12 A4 4 0 0 1 12 4 M4.5 20 C5.5 16.2 8.4 14.2 12 14.2 C15.6 14.2 18.5 16.2 19.5 20",
  people:
    "M9 5 A3.5 3.5 0 0 1 9 12 A3.5 3.5 0 0 1 9 5 M2.5 20 C3.3 16.6 5.8 14.6 9 14.6 C12.2 14.6 14.7 16.6 15.5 20 M15.5 5.2 A3.3 3.3 0 0 1 16 11.8 M17.6 14.8 C19.6 15.5 21 17.3 21.5 20",
  box: "M3.5 7.5 L12 3.5 L20.5 7.5 V16.5 L12 20.5 L3.5 16.5 Z M3.5 7.5 L12 11.5 L20.5 7.5 M12 11.5 V20.5",
  tray: "M3.5 13 L6.5 5 H17.5 L20.5 13 V19.5 H3.5 Z M3.5 13 H8.5 L10 15.5 H14 L15.5 13 H20.5",
  rise: "M3.5 17.5 L9.5 11.5 L13 15 L20.5 7.5 M15 7.5 H20.5 V13",
  bars: "M4 20 H20 M7.5 20 V12 M12 20 V5 M16.5 20 V9",
  sliders: "M4 7 H13 M17 7 H20 M15 5 V9 M4 17 H7 M11 17 H20 M9 15 V19",
  search: "M10.5 4 A6.5 6.5 0 0 1 10.5 17 A6.5 6.5 0 0 1 10.5 4 M15.3 15.3 L20 20",
  fold: "M4 4.5 H20 V19.5 H4 Z M9.5 4.5 V19.5 M15.5 9.5 L13 12 L15.5 14.5",
  more: "M6 12 H6.01 M12 12 H12.01 M18 12 H18.01",
  /** A value the console changes where it reads. */
  edit: "M4.5 19.5 L5.5 15 L15.5 5 L19 8.5 L9 18.5 Z M13.5 7 L17 10.5",
} as const;

/** The client app's tab bar (design/phase2/Client App, the tabs() data). */
export const TAB_ICONS = {
  home: "M3 11 L12 4 L21 11 M5.5 10 V20 H18.5 V10 M10 20 V14.5 H14 V20",
  visits: "M3.5 5.5 H20.5 V20.5 H3.5 Z M3.5 10 H20.5 M8 3.5 V7 M16 3.5 V7",
  photos: "M3.5 8 H7 L8.5 5.5 H15.5 L17 8 H20.5 V19 H3.5 Z M12 9.7 A3.8 3.8 0 0 1 12 17.3 A3.8 3.8 0 0 1 12 9.7",
  payments: "M7 4 H16 M7 8.5 H16 M7 13 C12 13 14.5 11.5 14.5 8.5 C14.5 6 12.8 4 9.5 4 M7 13 H10.5 L17 20.5",
  refer: APP_ICONS.share,
} as const;

/** The stage drawings' two lines: the head's outline, and the hair and the thinning zone within it. */
export const DRAWING_STROKES = { outline: 1.4, detail: 1.1 } as const;

/** The head outline behind the stage drawings, in a 64 × 74 box. */
export const HEAD_OUTLINE = "M32 5 C47 5 55 19 55 39 C55 58 45 69 32 69 C19 69 9 58 9 39 C9 19 17 5 32 5 Z";
