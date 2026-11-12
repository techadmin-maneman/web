// The technician app in Hindi (apps/tech/src/lang/): its words derived from the prototype's catalog as the prototype
// derives them; names, sectors and amounts left as they are; a switch of language read at once, with nothing
// remounted; and the lines the catalog does not yet word, which docs/technician-redesign/REPORT.md lists for the
// native speaker's review. A line added to the app without Hindi is added to that list, or given Hindi.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as content from "../../../apps/tech/src/content.ts";
import { hasHindi, readsHindi, toHindi } from "../../../apps/tech/src/lang/hindi.ts";
import { speak } from "../../../apps/tech/src/lang/language.ts";
import { localised, sayKnown, theirs } from "../../../apps/tech/src/lang/words.ts";
import { taskFor } from "../../../apps/tech/src/visit/tasks.ts";
import { CHECKLIST, LOST_REASONS, PARTIAL_REASONS } from "../../../src/config/job-sheet.ts";
import catalog from "../../../design/tech-redesign/strings-hi.json" with { type: "json" };
import app from "../../../apps/tech/src/lang/app-hi.json" with { type: "json" };

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

  it("stays English where the catalog cannot word it, and a line with no words of ours needs none", () => {
    expect(toHindi("Gate code 4417")).toBe("Gate code 4417");
    expect(hasHindi("+91")).toBe(true);
    expect(hasHindi("Gate code 4417")).toBe(false);
    // A sector stays as written, and asks for no Hindi.
    expect(hasHindi("Sector 65")).toBe(true);
    // A code the catalog keeps as it is counts as worded; a line worded only in part does not.
    expect(hasHindi("SOS")).toBe(true);
    expect(hasHindi("Navigate · Gate code 4417")).toBe(false);
  });

  it("words the app's own lines after the catalog's, the singular and a lower-case part among them", () => {
    expect(toHindi("1 job today")).toBe("आज 1 जॉब");
    expect(toHindi("This visit isn’t yours any more.")).toBe("यह विज़िट अब आपकी नहीं है।");
    expect(toHindi("Next: clean the scalp")).toBe("आगे: स्कैल्प साफ़ करें");
  });

  it("words what a rule holds, so a count, a date or a part in it is in Hindi too", () => {
    expect(toHindi("Map · 12 min drive")).toBe("नक्शा · 12 मिनट ड्राइव");
    expect(toHindi("Expired 31 Oct 2026")).toBe("31 अक्टू 2026 को एक्सपायर");
    expect(toHindi("Ops moved this job to 9 am on Mon 5 Oct.")).toBe("ऑप्स ने यह जॉब सोम 5 अक्टू, 9 am पर कर दिया।");
    expect(toHindi("Opens at 9 am on Mon 16 Nov.")).toBe("सोम 16 नवं, 9 am खुलेगा।");
  });

  it("moves a job named by its time to a time, and keeps a space after a line and a place's own words", () => {
    expect(toHindi("2 pm की सर्विस विज़िट moved to 4:15 pm")).toBe("2 pm की सर्विस विज़िट का समय 4:15 pm हुआ");
    expect(toHindi("Note from Imran: ")).toBe("Imran का नोट: ");
    expect(toHindi("18 min drive to Sun City, Sector 54")).toBe("Sun City, Sector 54 तक 18 मिनट ड्राइव");
    // The week's span on Schedule.
    expect(toHindi("12 Nov to 25 Nov · 14 jobs")).toBe("12 नवं से 25 नवं · 14 जॉब");
  });

  it("tries no rule on a line longer than any the catalogs word", () => {
    const long = "1 to ".repeat(500);
    expect(toHindi(long)).toBe(long);
  });

  it("uses no lookbehind, which an iPhone before iOS 16.4 cannot read", () => {
    const rules = [catalog, app].flatMap((each) => each.patterns.map((pattern) => pattern.match));
    expect(rules.filter((rule) => rule.includes("(?<"))).toEqual([]);
    expect(readFileSync("apps/tech/src/lang/hindi.ts", "utf8")).not.toContain("(?<");
  });
});

describe("a line ops wrote in the console", () => {
  it("is in Hindi where a catalog holds the whole of it, and as written otherwise, never in part", () => {
    speak("hi");
    expect(sayKnown("Hair system removed")).toBe("हेयर सिस्टम उतारा");
    expect(sayKnown("Lace and skin remover")).toBe("Lace and skin remover");
    expect(sayKnown("Moved to another city")).toBe("Moved to another city");
    expect(sayKnown("Open the template box")).toBe("Open the template box");
  });

  it("stays as typed inside a catalog line, which is worded around it, and is unmarked in English", () => {
    speak("hi");
    expect(content.visit.sentBack(theirs("Front view out of focus"))).toBe(
      "ऑप्स ने यह लौटाया: Front view out of focus",
    );
    expect(content.steps.consumables.count(theirs("Roll of tape"), 3)).toBe("Roll of tape: 3");
    expect(content.oneVisit.inKit(theirs("French lace of 8 x 10"))).toBe("French lace of 8 x 10 आपकी किट में है");
    // A reason past the length any catalog line has still leaves the line around it worded.
    const long = "Retake the front view ".repeat(14).trim();
    expect(content.visit.sentBack(theirs(long))).toBe(`ऑप्स ने यह लौटाया: ${long}`);
    speak("en");
    expect(content.visit.sentBack(theirs("Front view out of focus"))).toBe(
      "Ops sent this back: Front view out of focus",
    );
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

/**
 * A name, a count, one, none and nothing: each function's every branch, from "1 job" to "Alerts" with none unread; and
 * a time and a list, for the functions that take one.
 */
const SAMPLE_NAME = "Rohit M.";
const SAMPLES: readonly unknown[] = [
  SAMPLE_NAME,
  2,
  1,
  0,
  null,
  "2026-11-12T18:00:00+05:30",
  [SAMPLE_NAME, "Sector 65"],
];
/** As many values as the catalog's longest function takes: a function read through the catalog has no length. */
const MOST_ARGUMENTS = 3;

/** Every line the catalog can show: its strings, and what its functions write for sample values. */
function shown(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    const write = value as (...args: unknown[]) => unknown;
    for (const sample of SAMPLES) {
      try {
        shown(write(...Array.from({ length: MOST_ARGUMENTS }, () => sample)), out);
      } catch {
        // A function that needs a value of another kind writes nothing for this one.
      }
    }
  } else if (Array.isArray(value)) value.forEach((each) => shown(each, out));
  else if (typeof value === "object" && value !== null) Object.values(value).forEach((each) => shown(each, out));
  return out;
}

/** Why a step was stopped, each way the API says it: a field or a note, a job given to another, a start moved. */
function stoppedLines(): string[] {
  const now = new Date("2026-11-12T06:00:00.000Z");
  const codes = ["superseded", "technician", "time", "status", "out_of_order", "not_today", "too_early_to_arrive"];
  const more = ["already_started", "photo_rejected", "stuck", "not_found", "already_closed", "piece_code", "old_piece"];
  const last = ["product", "done", "reason", "invalid_request", "unknown", "a code not known"];
  const moved = [null, "2026-11-12T05:10:00.000Z", "2026-11-10T05:10:00.000Z"].map((at) => ({
    note: null,
    fields: ["technician"],
    moved: { technician: SAMPLE_NAME, at },
  }));
  const starts = ["2026-11-12T12:30:00.000Z", "2026-11-13T04:00:00.000Z", "2026-11-16T04:00:00.000Z"];
  return [
    ...[...codes, ...more, ...last].flatMap((code) => [
      content.whatStopped({ note: null, fields: [code] }, now),
      content.whatStopped({ note: code, fields: [] }, now),
    ]),
    ...moved.map((why) => content.whatStopped(why, now)),
    ...starts.map((start) =>
      content.whatStopped({ note: null, fields: ["time"], startsAt: "2026-11-12T09:00:00.000Z" }, now, start),
    ),
  ];
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

/** Every line the app can show: the catalog's, the job sheet's committed lists with their tasks' words, each stop. */
function everyLine(): string[] {
  const { languageNames: _ownNames, ...words } = content;
  const items = [...Object.values(CHECKLIST).flat(), ...PARTIAL_REASONS, ...LOST_REASONS];
  const sheet = items.flatMap((item) => [sayKnown(item.label), ...shown(taskFor(item), [])]);
  return [...shown(Object.values(words), []), ...sheet, ...stoppedLines()];
}

/** Each line in English, beside it as a Hindi screen draws it: read in Hindi, a list joined in Hindi. */
function inBoth(): (readonly [string, string])[] {
  speak("en");
  const english = everyLine();
  speak("hi");
  const hindi = everyLine();
  speak("en");
  // Each sample writes the one line in either language, so the two lists pair up line by line.
  expect(hindi).toHaveLength(english.length);
  return english.map((line, at) => [line, hindi[at] ?? line] as const);
}

/**
 * A sample of the wrong kind can write "null", "NaN" or "Invalid" where a value goes, or put a name, a time or a list
 * where a count or a date goes ("leave in Rohit M. min"): no screen shows those.
 */
const sampled = (line: string): boolean =>
  /undefined|null|NaN|Invalid/.test(line) || /(?:Rohit M\.|\+05:30|Sector 65) (?:min|to)\b/.test(line);

describe("the lines still in English", () => {
  it("are those REPORT.md lists for the native speaker, and no other", () => {
    // Each line judged as the screen shows it in Hindi, not as the rules would word it again.
    const untold = inBoth().filter(([line, hindi]) => !sampled(line) && !readsHindi(hindi, [SAMPLE_NAME]));
    const english = [...new Set(untold.map(([line]) => spaced(line)))].sort();
    expect(listed().sort()).toEqual(english);
  });
});
