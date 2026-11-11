// The catalog as each screen reads it (../content.ts): in English, each word as written; in Hindi, each string and
// each line a function writes put into Hindi as it is read (./hindi.ts). Read when drawn, so a switch of language
// draws every screen again in the new one without remounting it.

import { toHindi } from "./hindi.ts";
import { languageNow } from "./language.ts";

const worded = new WeakMap<object, unknown>();

const said = (value: unknown): unknown =>
  typeof value === "string" && languageNow() === "hi" ? toHindi(value) : value;

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
export const sayNow = (text: string): string => (languageNow() === "hi" ? toHindi(text) : text);
