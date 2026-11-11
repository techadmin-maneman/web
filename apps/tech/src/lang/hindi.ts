// The app's words in Hindi (docs/technician-redesign/PLAN.md, decision 10), derived from the prototype's catalog
// (design/tech-redesign/strings-hi.json) as the prototype derives them: an exact string; then each pattern, in order,
// then each template; "Next: …" and "Compare with …" around a translated rest; a line of parts joined by " · ", part by
// part; and weekdays and months where the line holds a figure. Names, sectors, codes, product names, amounts and am/pm
// are never in the catalog, so they stay as they are. The app's own lines, which the prototype does not draw, are in
// ./app-hi.json, read after the catalog in the same way. A line neither words stays English.

import catalog from "../../../../design/tech-redesign/strings-hi.json" with { type: "json" };
import app from "./app-hi.json" with { type: "json" };

const STRINGS: Readonly<Record<string, string>> = { ...app.strings, ...catalog.strings };
const TOKENS: Readonly<Record<string, string>> = { ...catalog.dateTokens, ...app.dateTokens };
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
  ...app.patterns.map((pattern) => [new RegExp(pattern.match), pattern.hi] as const),
];

const own = (text: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(STRINGS, text) ? STRINGS[text] : undefined;

/** Weekdays and months in Hindi, where the line holds a figure: "Wed 11 Nov". */
const dated = (text: string): string =>
  /\d/.test(text) ? text.replace(new RegExp(TOKEN.source, "g"), (token) => TOKENS[token] ?? token) : text;

/** A rule's line, each part it holds put into Hindi in turn: "Map · 12 min drive", while a name or a time stays. */
const ruled = (core: string, rule: RegExp, hindi: string): string =>
  core.replace(rule, (...found: unknown[]) =>
    hindi.replace(/\$(\d+)/g, (_, at: string) => {
      const part = found[Number(at)];
      return typeof part === "string" ? toHindi(part) : "";
    }),
  );

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
    if (rule.test(core)) return ruled(core, rule, hindi);
  }
  if (core.startsWith("Next: ")) return `आगे: ${toHindi(core.slice(6))}`;
  if (core.startsWith("Compare with ")) return `${toHindi(core.slice(13))} से मिलाएँ`;
  if (core.includes(" · ")) {
    const parts = core.split(" · ");
    const worded = parts.map(toHindi);
    if (worded.join("|") !== parts.join("|")) return worded.join(" · ");
  }
  // A line begun in lower case inside another, "Next: clean the scalp", is the catalog's line with its capital.
  if (/^[a-z]/.test(core)) {
    const capitalised = core.charAt(0).toUpperCase() + core.slice(1);
    const worded = toHindi(capitalised);
    if (worded !== capitalised) return worded;
  }
  const withDate = dated(core);
  return withDate === core ? text : withDate;
}

/**
 * Whether the line is in Hindi, has no words to put into it, or is one a catalog keeps as it is (a code, "SOS"): the
 * test that lists the lines still in English asks.
 */
export function hasHindi(text: string): boolean {
  if (own(text.trim()) !== undefined) return true;
  const hindi = toHindi(text);
  return /[ऀ-ॿ]/.test(hindi) || !/[A-Za-z]/.test(hindi);
}
