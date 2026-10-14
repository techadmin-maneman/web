// What a stylesheet may not write for itself, for the token tests of the site and of the apps
// (test/node/site/site-tokens.test.ts, test/node/apps/app/app-tokens.test.ts): every colour, size, space, weight, leading,
// duration and curve comes from packages/brand.

/** The colours CSS knows by name. `transparent` and `currentColor` are not among them: they name no colour. */
const NAMED_COLOURS = [
  "white",
  "black",
  "red",
  "green",
  "blue",
  "gray",
  "grey",
  "silver",
  "yellow",
  "orange",
  "purple",
  "navy",
  "maroon",
  "olive",
  "teal",
  "aqua",
  "fuchsia",
  "lime",
  "brown",
  "pink",
  "gold",
  "beige",
  "ivory",
  "tan",
] as const;

const PATTERNS = [
  // A colour written out: #hex, rgb(), hsl(), or by name where a colour goes.
  /#[0-9a-fA-F]{3,8}\b/g,
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g,
  new RegExp(
    `(?:^|[;{\\s])(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border|outline(?:-color)?|fill|stroke|box-shadow|text-decoration(?:-color)?)\\s*:[^;}]*(?<![\\w-])(?:${NAMED_COLOURS.join("|")})\\b`,
    "g",
  ),
  // A length: px, em, rem, the viewport's units, except the whole viewport's height.
  /\b\d+(?:\.\d+)?(?:px|em|rem|vw|vmin|vmax)\b/g,
  /\b(?!100[dsl]?vh\b)\d+(?:\.\d+)?[dsl]?vh\b/g,
  // A duration, and an easing curve.
  /(?<![\w-])\d+(?:\.\d+)?m?s\b/g,
  /\bcubic-bezier\(/g,
  // A weight or a leading written as a number.
  /\bweight\s*:\s*\d+/g,
  /\bline-height\s*:\s*\d*\.?\d+(?![\w%])/g,
  // A line's weight in a drawing, which a size names as any other does.
  /\bstroke-width\s*:\s*\d/g,
  // A print or a type unit: points, millimetres, centimetres, characters and x-heights.
  /\b\d+(?:\.\d+)?(?:pt|mm|cm|ch|ex)\b/g,
  // A layer, and an opacity that is neither none nor all.
  /\bz-index\s*:\s*-?\d+/g,
  /\bopacity\s*:\s*(?!(?:0|1)\s*[;}])\d*\.?\d+/g,
] as const;

/**
 * Comments, media conditions and @page rules taken out: a condition, and a printed page's size, cannot use custom
 * properties. A condition's widths are held to the one list in packages/brand/breakpoints.ts instead.
 */
export function withoutCommentsAndConditions(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@media[^{]*\{/g, "@media {")
    .replace(/@page[^{]*\{[^}]*\}/g, "");
}

/**
 * A screen's own sizes, which nothing else draws: a :root block of --local-* properties at the top of its stylesheet,
 * where each value is written once, named and explained (ADR 0077, as amended), rather than in the shared brand
 * package. Nowhere else may a stylesheet write a value.
 */
const LOCAL_SIZES = /^\s*:root\s*\{(?:\s*--local-[\w-]+\s*:[^;{}]*;)+\s*\}/;

/** Every raw value in a stylesheet: a colour, a length, a duration, a curve, a weight or a leading. */
export function rawValues(css: string): string[] {
  const plain = withoutCommentsAndConditions(css).replace(LOCAL_SIZES, "");
  return PATTERNS.flatMap((pattern) => [...plain.matchAll(pattern)].map((match) => match[0].trim()));
}
