/**
 * A token's value as the page's stylesheet holds it, for what a page draws
 * outside CSS -- a canvas, a payment window's own buttons: cssToken("--ink") is
 * the ink, as tokens.css defines it, and never written again (DS-19).
 */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
