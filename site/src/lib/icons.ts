// The design's line icons, as path data in a 24 × 24 box. They are drawn in
// currentColor, so a component sets their colour through CSS.

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

/** The head outline behind the stage drawings, in a 64 × 74 box. */
export const HEAD_OUTLINE = "M32 5 C47 5 55 19 55 39 C55 58 45 69 32 69 C19 69 9 58 9 39 C9 19 17 5 32 5 Z";

/** A wa.me link to the business number, with an optional message. */
export function whatsappLink(number: string, text?: string): string {
  return text === undefined ? `https://wa.me/${number}` : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
