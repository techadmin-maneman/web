// The technician app in Hindi (apps/tech/src/lang/): its words derived from the prototype's catalog as the prototype
// derives them; names, sectors and amounts left as they are; a switch of language read at once, with nothing
// remounted; and the lines the catalog does not yet word, which docs/technician-redesign/REPORT.md lists for the
// native speaker's review. A line added to the app without Hindi is added to that list, or given Hindi.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as content from "../../../apps/tech/src/content.ts";
import { hasHindi, toHindi } from "../../../apps/tech/src/lang/hindi.ts";
import { speak } from "../../../apps/tech/src/lang/language.ts";
import { localised } from "../../../apps/tech/src/lang/words.ts";

afterEach(() => {
  speak("en");
});

describe("a line in Hindi", () => {
  it("is the catalog's own, where it holds the line", () => {
    expect(toHindi("Today")).toBe("आज");
    expect(toHindi("Navigate")).toBe("रास्ता");
  });

  it("follows the catalog's patterns and templates, keeping a name as it is", () => {
    expect(toHindi("3 jobs today")).toBe("आज 3 जॉब");
    expect(toHindi("Call Rohit M.")).toBe("Rohit M. को कॉल");
  });

  it("is worded part by part across a ·, and its weekdays and months put in Hindi where it holds a figure", () => {
    expect(toHindi("Today · Navigate")).toBe("आज · रास्ता");
    expect(toHindi("Wed 11 Nov")).toBe("बुध 11 नवं");
  });

  it("stays English where the catalog cannot word it, and a line with no words needs none", () => {
    expect(toHindi("Sector 65")).toBe("Sector 65");
    expect(hasHindi("+91")).toBe(true);
    expect(hasHindi("Sector 65")).toBe(false);
  });
});

describe("the catalog as the screens read it", () => {
  it("speaks the language chosen, from the next read on, without a new copy of the screen's words", () => {
    const words = localised({ title: "Today", count: (jobs: number) => `${String(jobs)} jobs today`, rows: ["Me"] });
    expect([words.title, words.count(3), words.rows[0]]).toEqual(["Today", "3 jobs today", "Me"]);
    speak("hi");
    expect([words.title, words.count(3), words.rows[0]]).toEqual(["आज", "आज 3 जॉब", "मैं"]);
  });
});

/** Every line the catalog can show: its strings, and what its functions write for sample values. */
function shown(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    const write = value as (...args: unknown[]) => unknown;
    for (const sample of ["Rohit M.", 2]) {
      try {
        shown(write(...Array.from({ length: Math.max(write.length, 1) }, () => sample)), out);
      } catch {
        // A function that needs a value of another kind writes nothing for this one.
      }
    }
  } else if (Array.isArray(value)) value.forEach((each) => shown(each, out));
  else if (typeof value === "object" && value !== null) Object.values(value).forEach((each) => shown(each, out));
  return out;
}

const REPORT = "docs/technician-redesign/REPORT.md";
/** Spaces as a Markdown file keeps them, one at a time. */
const spaced = (line: string): string => line.replace(/ {2,}/g, " ");
const START = "<!-- still-english:start -->";
const END = "<!-- still-english:end -->";

/** The lines REPORT.md lists as still in English, one to a bullet, as written. */
function listed(): string[] {
  const text = readFileSync(REPORT, "utf8");
  const block = text.slice(text.indexOf(START) + START.length, text.indexOf(END));
  return block
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => spaced(JSON.parse(line.slice(2)) as string));
}

describe("the lines still in English", () => {
  it("are those REPORT.md lists for the native speaker, and no other", () => {
    const { languageNames: _ownNames, ...words } = content;
    const lines = [...new Set(shown(Object.values(words), []))].filter((line) => !line.includes("undefined"));
    const english = [...new Set(lines.filter((line) => !hasHindi(line)).map(spaced))].sort();
    expect(listed().sort()).toEqual(english);
  });
});
