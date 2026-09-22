// The tab bar's glyphs (design/phase2/Client App, the tabs() data), in the
// icon set's 24 px box with a 1.6 stroke, and the other glyphs the app draws
// that the icon set lacks. The rest come from @maneman/brand/icons.

export const TAB_ICONS = {
  home: "M3 11 L12 4 L21 11 M5.5 10 V20 H18.5 V10 M10 20 V14.5 H14 V20",
  visits: "M3.5 5.5 H20.5 V20.5 H3.5 Z M3.5 10 H20.5 M8 3.5 V7 M16 3.5 V7",
  photos: "M3.5 8 H7 L8.5 5.5 H15.5 L17 8 H20.5 V19 H3.5 Z M12 9.7 A3.8 3.8 0 0 1 12 17.3 A3.8 3.8 0 0 1 12 9.7",
  payments: "M7 4 H16 M7 8.5 H16 M7 13 C12 13 14.5 11.5 14.5 8.5 C14.5 6 12.8 4 9.5 4 M7 13 H10.5 L17 20.5",
  refer: "M12 15 V4 M8 8 L12 4 L16 8 M5 14 V20 H19 V14",
} as const;

/** Beside A2's "Read automatically": the WhatsApp glyph's bubble without its handset, as the design draws it. */
export const BUBBLE =
  "M20 11.5 C20 16.2 16.2 20 11.5 20 C9.9 20 8.4 19.6 7.2 18.8 L3.5 19.5 L4.3 15.9 C3.5 14.6 3 13.1 3 11.5 C3 6.8 6.8 3 11.5 3 C16.2 3 20 6.8 20 11.5 Z";

/** A past visit's row opens its detail (board C1). */
export const CHEVRON = "M9 5 L16 12 L9 19";

/** Beside board C4's "Slot held": a clock face. */
export const CLOCK = "M12 3.5 A8.5 8.5 0 0 1 12 20.5 A8.5 8.5 0 0 1 12 3.5 M12 7.5 V12 L15 14.5";

/** In board C4's chosen way to pay. */
export const CHECK = "M5 13 L10 18 L19 6";
