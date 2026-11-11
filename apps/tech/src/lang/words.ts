// The catalog as each screen reads it (../content.ts): in English, each word as written; in Hindi, each string and
// each line a function writes put into Hindi as it is read (./hindi.ts). Read when drawn, so a switch of language
// draws every screen again in the new one without remounting it.

import { toHindi, wholeLine } from "./hindi.ts";
import { languageNow } from "./language.ts";

const worded = new WeakMap<object, unknown>();

// Ops' words inside a catalog line, as `theirs` marks them: hidden behind a placeholder no rule can split while the
// line is put into Hindi, then put back as typed. In English the marks are taken out.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const MARKED = /\uE000([^\uE000\uE001]*)\uE001/g;
const PLACE = /\uE002(\d+)\uE003/g;

/** Ops' words (a reason, a consumable's or a product's name) given to a catalog line, kept as typed within it. */
export const theirs = (text: string): string => (text === "" ? text : `${OPEN}${text}${CLOSE}`);

function inLanguageNow(line: string): string {
  if (languageNow() !== "hi") return line.replace(MARKED, "$1");
  const held: string[] = [];
  const hidden = line.replace(MARKED, (_, text: string) => `\uE002${String(held.push(text) - 1)}\uE003`);
  return toHindi(hidden).replace(PLACE, (_, at: string) => held[Number(at)] ?? "");
}

const said = (value: unknown): unknown => (typeof value === "string" ? inLanguageNow(value) : value);

/** A part of the catalog, its words said in the language now. */
export function localised<T extends object>(words: T): T {
  const known = worded.get(words);
  if (known !== undefined) return known as T;
  const proxy = new Proxy(words, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      // An array's own methods, and anything inherited, are the language's own: only the catalog's words are said.
      if (!Object.prototype.hasOwnProperty.call(target, key)) return value;
      if (typeof value === "function") {
        return (...args: unknown[]) => said((value as (...given: unknown[]) => unknown)(...args));
      }
      if (typeof value === "object" && value !== null) return localised(value);
      return said(value);
    },
  });
  worded.set(words, proxy);
  return proxy;
}

/** One line in the language now: for a line the catalog writes outside an object of it. */
export const sayNow = (text: string): string => inLanguageNow(text);

/**
 * A line ops wrote in the console (a checklist item, a reason, a consumable's name) in the language now: in Hindi
 * where a catalog holds the whole line, as written otherwise, and never worded in part.
 */
export const sayKnown = (text: string): string => (languageNow() === "hi" ? (wholeLine(text) ?? text) : text);
