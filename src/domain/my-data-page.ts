// The readable copy of a client's data export: one page they download and can open anywhere, each part under its
// heading, each field under its label, every time in India's. Its words are src/config/my-data.ts.

import { fullDate, indiaClock, longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { MY_DATA, type Field, type Part } from "../config/my-data.ts";
import { NOTICES } from "../config/notices.ts";

const STYLE = `
  body { margin: 0 auto; max-width: 42rem; padding: 2rem 1rem 4rem; background: #fff; color: #1c1c1c;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.125rem; margin: 2.5rem 0 0.75rem; padding-bottom: 0.25rem; border-bottom: 1px solid #d9d9d9; }
  dl { display: grid; grid-template-columns: minmax(8rem, 40%) 1fr; gap: 0.25rem 1rem; margin: 0 0 1rem; }
  dl + dl { padding-top: 1rem; border-top: 1px dashed #d9d9d9; }
  dl div { display: contents; }
  dt, .quiet { color: #5c5c5c; }
  dd { margin: 0; overflow-wrap: anywhere; }
`;

/** The whole page, from what everythingHeldAbout gave. */
export function myDataPage(held: Readonly<Record<string, unknown>>, exportedAt: Date): string {
  const parts: Readonly<Record<string, Part>> = MY_DATA.parts;
  const sections = Object.entries(parts).map(([key, part]) => partSection(part, held[key]));
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped(MY_DATA.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escaped(MY_DATA.title)}</h1>
<p class="quiet">${escaped(MY_DATA.downloaded(indiaTime(exportedAt.toISOString())))}</p>
<p class="quiet">${escaped(MY_DATA.photos)}</p>
${sections.join("\n")}
</body>
</html>
`;
}

function partSection(part: Part, value: unknown): string {
  const rows = rowsOf(value);
  const body =
    rows.length === 0 ? `<p class="quiet">${escaped(MY_DATA.none)}</p>` : rows.map((row) => rowList(part, row)).join("");
  return `<section><h2>${escaped(part.title)}</h2>${body}</section>`;
}

/** A part's rows: a list as it is, one row as a list of one, and nothing as none. */
function rowsOf(value: unknown): Readonly<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value === null || value === undefined) return [];
  return [value as Record<string, unknown>];
}

/** One row, each field it holds under its label; an empty field is left out. */
function rowList(part: Part, row: Readonly<Record<string, unknown>>): string {
  const items = Object.entries(part.fields).flatMap(([key, field]) => {
    const shown = readable(field, row[key]);
    if (shown === null) return [];
    return [`<div><dt>${escaped(field.label)}</dt><dd>${escaped(shown)}</dd></div>`];
  });
  return `<dl>${items.join("")}</dl>`;
}

/** A value as the page writes it; null for an empty one. */
function readable(field: Field, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (field.as) {
    case "time":
      return indiaTime(String(value));
    case "day":
      return dayOf(String(value));
    case "money":
      return typeof value === "number" ? rupees(value) : String(value);
    case "yesNo":
      return value === 1 || value === true ? "Yes" : "No";
    case "words":
      return Array.isArray(value) ? value.map((each) => wordsOf(String(each))).join(", ") : wordsOf(String(value));
    case "purpose":
      return purposeTitle(String(value));
    case "purposes":
      return purposesOf(String(value));
    case "notice":
      return noticeText(String(value));
    case "text":
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

/** "2026-09-21T06:30:00.000Z" → "21 Sep 2026, 12 pm". */
function indiaTime(isoInstant: string): string {
  return `${longDate(isoInstant)}, ${indiaClock(isoInstant)}`;
}

/** A date as it is, or an instant as India's date: some older columns hold a day as an instant. */
function dayOf(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? fullDate(value) : longDate(value);
}

/** A stored code as words: "first_fit" → "First fit". */
function wordsOf(code: string): string {
  const spaced = code.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function purposeTitle(purpose: string): string {
  const titles: Readonly<Record<string, string>> = MY_DATA.purposes;
  return titles[purpose] ?? wordsOf(purpose);
}

/** A JSON list of purposes, as their titles; anything else as it is. */
function purposesOf(stored: string): string {
  let purposes: unknown;
  try {
    purposes = JSON.parse(stored);
  } catch {
    return stored;
  }
  if (!Array.isArray(purposes)) return stored;
  return purposes.map((purpose) => purposeTitle(String(purpose))).join(", ");
}

/** The words a notice's version showed; a version no notice has, such as an erasure's withdrawal, as words. */
function noticeText(version: string): string {
  const notice = NOTICES.find((each) => each.version === version);
  return notice === undefined ? wordsOf(version) : notice.text.join(" ");
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escaped(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}
