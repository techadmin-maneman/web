// The brand's colours as values, for what is drawn outside a stylesheet at
// build time: the apps' icons and manifests, the site's card images and
// favicons, and the house referral card. Each is read from tokens.css by its
// name, so a colour has one value wherever it is drawn (DS-19). A page reads
// its colours from its own stylesheet instead (packages/ui/cssToken.ts).

/** A colour token's value in `tokens`, the text of tokens.css: colourOf("--ink", tokens) → "#16233a". */
export function colourOf(name: string, tokens: string): string {
  const found = new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (found?.[1] === undefined) throw new Error(`no colour ${name} in tokens.css`);
  return found[1];
}
