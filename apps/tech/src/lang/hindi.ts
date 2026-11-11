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
const NAMES = Object.keys(TOKENS).join("|");
/**
 * A weekday or month beside a figure, "Wed 11 Nov", "Mon, 5 Oct", "Nov 2026": never a word of a place's name. The
 * figure before a month is matched, not looked behind for, since an iPhone before iOS 16.4 cannot read a lookbehind.
 */
const DATE_WORD = new RegExp(`(\\d )(${NAMES})\\b|\\b(${NAMES})(?=,? \\d)`, "g");

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

/** Weekdays and months in Hindi, where they stand beside a figure. */
const dated = (text: string): string =>
  text.replace(DATE_WORD, (found: string, figure?: string, after?: string, before?: string) => {
    if (figure !== undefined && after !== undefined) return figure + (TOKENS[after] ?? after);
    return before === undefined ? found : (TOKENS[before] ?? before);
  });

/** Longer than any line the catalogs word: a line this long is not one of ours, and no rule is tried on it. */
const LONGEST_LINE = 300;

/** A line ops wrote in the console, in Hindi only where a catalog holds the whole of it; never worded in part. */
export const wholeLine = (text: string): string | undefined => own(text) ?? own(text.trim());

/** A rule's line, each part it holds put into Hindi in turn: "Map · 12 min drive", while a name or a time stays. */
const ruled = (core: string, rule: RegExp, hindi: string): string =>
  core.replace(rule, (...found: unknown[]) =>
    hindi.replace(/\$(\d+)/g, (_, at: string) => {
      const part = found[Number(at)];
      return typeof part === "string" ? toHindi(part) : "";
    }),
  );

/** The line in Hindi, or as it is where the catalog cannot word it; a space before or after it stays. */
export function toHindi(text: string): string {
  const exact = own(text);
  if (exact !== undefined) return exact;
  const core = text.trim();
  if (core === "" || core.length > LONGEST_LINE) return text;
  const worded = wordedCore(core);
  if (worded === core) return text;
  const at = text.indexOf(core);
  return text.slice(0, at) + worded + text.slice(at + core.length);
}

/** A line with no space at either end, in Hindi, or as it is. */
function wordedCore(core: string): string {
  const trimmed = own(core);
  if (trimmed !== undefined) return trimmed;
  // A catalog line begun in lower case inside another, "Front · face the camera, eyes level", before any rule splits it.
  const capitalised = own(core.charAt(0).toUpperCase() + core.slice(1));
  if (capitalised !== undefined) return capitalised;
  if (core.startsWith("· ")) {
    const rest = toHindi(core.slice(2));
    return rest === core.slice(2) ? core : `· ${rest}`;
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
  return dated(core);
}

/** What a line in Hindi keeps as written: am and pm, a unit, a brand, a place's sector, a code with a figure in it. */
const KEPT =
  /\b(?:am|pm|Rs|ml|km|WhatsApp|Mane Man|SOS|Razorpay|Google Maps|GST|UPI|Wi-Fi|SMS|Sector)\b|\b[A-Z]{2,}[\w-]*\d[\w-]*/g;

/**
 * Whether the line is wholly in Hindi but for what stays as written, the names it holds among it, or is one a catalog
 * keeps as it is (a Norwood stage, "SOS"): the test that lists the lines still in English asks.
 */
export function hasHindi(text: string, names: readonly string[] = []): boolean {
  if (own(text.trim()) !== undefined) return true;
  const hindi = names.reduce(
    (line, name) => line.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), ""),
    toHindi(text),
  );
  return !/[A-Za-z]{2,}/.test(hindi.replace(KEPT, ""));
}
