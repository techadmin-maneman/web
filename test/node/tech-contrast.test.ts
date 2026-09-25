// The technician app is read at arm's length in direct sun, so its colours are
// held to the design's own rule (docs/prompts/phase2-frontend.md): "Every
// colour pairing meets the design's contrast table: at least 5.8:1, and 7:1 for
// all but one pairing. A test checks each pair." This is that test.
//
// The board's table was wrong about two pairs it draws: the disabled action,
// #A8B2C2 on #2A3A56, is 5.34:1 and not the 7.0 it claims, and an angle not yet
// taken, #8C96A8 on #131C2E, is 5.71:1. The app draws both lighter, which is
// ADR 0025's "The technician boards".
//
// A pairing is a text colour on the ground it sits on. Which ground a word sits
// on is the page's to say, not one rule's, so the pairings are listed below by
// hand; the test then reads every stylesheet of the app, so a colour or a
// ground that is not listed fails it rather than slipping by.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Pairing {
  readonly text: string;
  readonly ground: string;
  readonly where: string;
}

const PAIRINGS: readonly Pairing[] = [
  { text: "--paper", ground: "--ink-deep", where: "every screen's words" },
  { text: "--ink-soft", ground: "--ink-deep", where: "a line beneath a heading, access notes, a caution" },
  { text: "--ink-muted", ground: "--ink-deep", where: "labels: a stage's name, a row's key (the one below 7:1)" },
  { text: "--gilt", ground: "--ink-deep", where: "the job in hand's type, the badge, a step's count" },
  { text: "--error-on-ink", ground: "--ink-deep", where: "a check-in that failed, a job whose queue stopped" },
  { text: "--ink-deep", ground: "--gilt", where: "the one primary action, the offline banner" },
  { text: "--ink-tag", ground: "--ink-disabled", where: "an action not usable yet" },
  { text: "--paper", ground: "--ink-frame", where: "the capture screen, when the camera will not open" },
  { text: "--ink-soft", ground: "--ink-frame", where: "the capture guide, an angle not taken yet" },
  { text: "--paper", ground: "--ink-raised", where: "an angle taken, a chosen outcome" },
];

/** Grounds that never carry a word: the upload bar's track, and the scrim behind a confirmation. */
const WORDLESS_GROUNDS = new Set(["--ink-rule", "--ink-night"]);

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** Every token each rule sets as a text colour and as a ground, and the rules that set both. */
function coloursUsed(): { texts: Set<string>; grounds: Set<string>; both: [string, string, string][] } {
  const texts = new Set<string>();
  const grounds = new Set<string>();
  const both: [string, string, string][] = [];
  for (const file of stylesheets("apps/tech/src")) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selector = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      let text: string | null = null;
      let ground: string | null = null;
      for (const declaration of body.split(";")) {
        const [property = "", value = ""] = declaration.split(/:(.*)/s).map((part) => part.trim());
        const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
        if (token === undefined) continue;
        if (property === "color") text = token;
        if (property === "background" || property === "background-color") ground = token;
      }
      if (text !== null) texts.add(text);
      if (ground !== null) grounds.add(ground);
      if (text !== null && ground !== null) both.push([selector.trim(), text, ground]);
    }
  }
  return { texts, grounds, both };
}

const TOKENS = new Map(
  ["packages/brand/tokens.css", "packages/brand/tokens-phase2.css"].flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(
      ([, name = "", hex = ""]) => [name, hex] as const,
    ),
  ),
);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG's contrast ratio between two colours. */
function ratio(text: string, ground: string): number {
  const [lighter, darker] = [luminance(text), luminance(ground)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function ratioOf(pairing: Pairing): number {
  const text = TOKENS.get(pairing.text);
  const ground = TOKENS.get(pairing.ground);
  if (text === undefined || ground === undefined) throw new Error(`${pairing.text} or ${pairing.ground} is no token`);
  return ratio(text, ground);
}

describe("the technician app's colour pairings", () => {
  it.each(PAIRINGS.map((pairing) => [`${pairing.text} on ${pairing.ground}`, pairing] as const))(
    "%s clears 5.8:1",
    (_name, pairing) => {
      expect(ratioOf(pairing)).toBeGreaterThanOrEqual(5.8);
    },
  );

  it("clears 7:1 in every pairing but one", () => {
    const below = PAIRINGS.filter((pairing) => ratioOf(pairing) < 7).map((pairing) => pairing.where);
    expect(below).toHaveLength(1);
  });

  it("draws the disabled action at 7:1 or better, which the board's own pair is not", () => {
    expect(ratio("#a8b2c2", "#2a3a56")).toBeLessThan(5.8);
    expect(ratioOf({ text: "--ink-tag", ground: "--ink-disabled", where: "" })).toBeGreaterThanOrEqual(7);
  });
});

describe("what the stylesheets use", () => {
  const used = coloursUsed();

  it("reads every stylesheet's colours, so the checks below check something", () => {
    expect(used.texts.size).toBeGreaterThanOrEqual(6);
    expect(used.both.length).toBeGreaterThanOrEqual(5);
  });

  it("sets no text colour the pairings do not list", () => {
    const listed = new Set(PAIRINGS.map((pairing) => pairing.text));
    expect([...used.texts].filter((token) => !listed.has(token))).toEqual([]);
  });

  it("sets no ground the pairings do not list, bar the ones that carry no words", () => {
    const listed = new Set(PAIRINGS.map((pairing) => pairing.ground));
    expect([...used.grounds].filter((token) => !listed.has(token) && !WORDLESS_GROUNDS.has(token))).toEqual([]);
  });

  it("pairs every rule that sets both a text colour and a ground as the pairings list it", () => {
    const listed = new Set(PAIRINGS.map((pairing) => `${pairing.text} on ${pairing.ground}`));
    const unlisted = used.both.filter(([, text, ground]) => !listed.has(`${text} on ${ground}`));
    expect(unlisted).toEqual([]);
  });
});
