// The app's words in Hindi (docs/technician-redesign/PLAN.md, decision 10), derived from the prototype's catalog
// (design/tech-redesign/strings-hi.json) as the prototype derives them: an exact string; then each pattern, in order,
// then each template; "Next: …" and "Compare with …" around a translated rest; a line of parts joined by " · ", part by
// part; and weekday and month abbreviations where the line holds a figure. Names, sectors, codes, product names,
// amounts and am/pm are never in the catalog, so they stay as they are. A line the catalog cannot word stays English.

import catalog from "../../../../design/tech-redesign/strings-hi.json" with { type: "json" };

const STRINGS: Readonly<Record<string, string>> = catalog.strings;
const TOKENS: Readonly<Record<string, string>> = catalog.dateTokens;
const TOKEN = new RegExp(`\\b(${Object.keys(TOKENS).join("|")})\\b`, "g");

/** "{first} is prepaid." as a rule: its words matched, each {name} any text, kept in the Hindi by its place. */
function templateRule([english, hindi]: readonly [string, string]): readonly [RegExp, string] {
  const names: string[] = [];
  const source = english
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name === undefined) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(name);
      return "(.+)";
    })
    .join("");
  const replacement = hindi.replace(/\{(\w+)\}/g, (_, name: string) => `$${String(names.indexOf(name) + 1)}`);
  return [new RegExp(`^${source}$`), replacement];
}

const RULES: readonly (readonly [RegExp, string])[] = [
  ...catalog.patterns.map((pattern) => [new RegExp(pattern.match), pattern.hi] as const),
  ...Object.entries(catalog.templates).map(templateRule),
];

const own = (text: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(STRINGS, text) ? STRINGS[text] : undefined;

/** The line in Hindi, or as it is where the catalog cannot word it. */
export function toHindi(text: string): string {
  const exact = own(text);
  if (exact !== undefined) return exact;
  const core = text.trim();
  if (core === "") return text;
  const trimmed = own(core);
  if (trimmed !== undefined) return trimmed;
  if (core.startsWith("· ")) {
    const rest = toHindi(core.slice(2));
    return rest === core.slice(2) ? text : `· ${rest}`;
  }
  for (const [rule, hindi] of RULES) {
    if (rule.test(core)) return core.replace(rule, hindi);
  }
  if (core.startsWith("Next: ")) return `आगे: ${toHindi(core.slice(6))}`;
  if (core.startsWith("Compare with ")) return `${toHindi(core.slice(13))} से मिलाएँ`;
  if (core.includes(" · ")) {
    const parts = core.split(" · ");
    const worded = parts.map(toHindi);
    if (worded.join("|") !== parts.join("|")) return worded.join(" · ");
  }
  if (/\d/.test(core) && new RegExp(TOKEN.source).test(core)) {
    return core.replace(new RegExp(TOKEN.source, "g"), (token) => TOKENS[token] ?? token);
  }
  return text;
}

/** Whether the line is in Hindi, or has no words to put into it: the test that lists the lines still in English asks. */
export const hasHindi = (text: string): boolean => !/[A-Za-z]/.test(text) || toHindi(text) !== text;
