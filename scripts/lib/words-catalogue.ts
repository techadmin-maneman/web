// Every line the Words page may change (docs/decisions/0126-the-words-page.md): each string of the site's copy, and
// each WhatsApp message to a client, with where it appears and its wording in the code. What stays locked is left
// out: the legal pages and the consent notices, which counsel approves; images, links, slugs and numerals; the
// business's structured details; and the login code's message, whose text WhatsApp and DLT fix. A sentence with a
// figure in it is a template whose holes the page fills, and is listed with them. src/config/words.json is this,
// written by scripts/build/generate-words.ts (`npm run words`, and `npm run gen`).

import REVIEWED from "../../src/config/words-reviewed.json" with { type: "json" };
import { TEMPLATES } from "../../src/config/message-templates.ts";
import * as guides from "../../site/src/content/guides.ts";
import * as referral from "../../site/src/content/referral.ts";
import * as service from "../../site/src/content/service.ts";
import * as contact from "../../site/src/content/site/contact.ts";
import * as home from "../../site/src/content/site/home.ts";
import * as pages from "../../site/src/content/site/pages.ts";
import * as tryon from "../../site/src/content/site/tryon.ts";

export interface WordLine {
  /** "site:home/hero.title", "message:visit_reminder_v1". */
  readonly key: string;
  readonly surface: "site" | "message";
  /** The page, or "Messages", as the Words page groups them. */
  readonly group: string;
  /** The part of the page, or the message's name. */
  readonly where: string;
  /** The wording in the code. */
  readonly text: string;
  /** Whether a copy review has read the line in this wording (`npm run words:reviewed`). */
  readonly reviewed: boolean;
}

/** Whether a copy review read a line in its wording now. */
const isReviewed = (key: string, text: string): boolean => (REVIEWED as Readonly<Record<string, string>>)[key] === text;

/** Each module of the site's copy, by the page it is read on; one with an export of its own pages is split below. */
const MODULES: readonly (readonly [string, string, Readonly<Record<string, unknown>>])[] = [
  ["home", "Home", home],
  ["pages", "Pages", pages],
  ["tryon", "Try-on", tryon],
  ["contact", "Contact", contact],
  ["guides", "Guides", guides],
  ["referral", "Invite page", referral],
  ["service", "Every page", service],
];

/** Exports that are a page of their own, beside their module's group. */
const PAGES: Readonly<Record<string, string>> = {
  "pages/booking": "Book",
  "pages/stopMessages": "Stop messages",
  "pages/notFound": "Page not found",
  "pages/pageTitles": "Page titles",
  "pages/pageDescriptions": "Page titles",
  "guides/areasPage": "Areas",
};

/** Exports that hold no copy to change: structured details, and the staging-only placeholder tag. */
const LOCKED_EXPORTS: ReadonlySet<string> = new Set(["contact/business", "home/placeholderTag"]);

/** Keys whose values are not copy: links, files, slugs, numerals and settings, and the lists of our cities. */
const NOT_COPY =
  /\.(?:href|file|src|poster|slug|id|icon|version|url|video|number|numeral|n|anchor|kind|state|cities)(?:\.\d+)?$/;

/** Values that are not copy: a path, a link, a file, a date, digits, punctuation, or a hole alone. */
function isCopy(text: string): boolean {
  if (/^[/#]|^https?:|^mailto:|^tel:/.test(text)) return false;
  if (/\.(?:jpe?g|png|webp|avif|svg|mp4|webm|vtt)$/i.test(text)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^[\d\s]+$/.test(text) || /^[\p{P}\s]*$/u.test(text)) return false;
  return !/^\{[a-zA-Z]+\}$/.test(text);
}

function linesOf(prefix: string, group: string, where: string, value: unknown): WordLine[] {
  if (typeof value === "string") {
    if (NOT_COPY.test(prefix) || !isCopy(value)) return [];
    const key = `site:${prefix}`;
    return [{ key, surface: "site", group, where, text: value, reviewed: isReviewed(key, value) }];
  }
  if (Array.isArray(value))
    return value.flatMap((each, index) => linesOf(`${prefix}.${String(index)}`, group, where, each));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([name, each]) => linesOf(`${prefix}.${name}`, group, where, each));
  }
  return [];
}

function siteLines(): WordLine[] {
  return MODULES.flatMap(([module, group, exports]) =>
    Object.entries(exports).flatMap(([name, value]) => {
      const at = `${module}/${name}`;
      // A string exported on its own cannot be set from outside its module, as a published line is.
      if (LOCKED_EXPORTS.has(at) || typeof value === "string") return [];
      return linesOf(at, PAGES[at] ?? group, name, value);
    }),
  );
}

/** The login code's message stays locked: DLT fixes the SMS's text, and WhatsApp writes its own. */
const LOCKED_MESSAGES: ReadonlySet<string> = new Set(["login_code_v1"]);

function messageLines(): WordLine[] {
  return Object.entries(TEMPLATES)
    .filter(([name]) => !LOCKED_MESSAGES.has(name))
    .map(([name, text]) => {
      const key = `message:${name}`;
      return { key, surface: "message", group: "Messages", where: name, text, reviewed: isReviewed(key, text) };
    });
}

export const wordsCatalogue = (): WordLine[] => [...siteLines(), ...messageLines()];

/** The catalogue as src/config/words.json holds it. */
export const wordsFile = (): string => `${JSON.stringify(wordsCatalogue(), null, 2)}\n`;
