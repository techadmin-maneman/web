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

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { edgeOf, ratio, rulesOf, tokenRatio } from "./contrast.ts";

interface Pairing {
  readonly text: string;
  readonly ground: string;
  readonly where: string;
}

const PAIRINGS: readonly Pairing[] = [
  { text: "--paper", ground: "--ink-deep", where: "every screen's words" },
  { text: "--ink-soft", ground: "--ink-deep", where: "a line beneath a heading, access notes, a caution" },
  { text: "--ink-muted", ground: "--ink-deep", where: "labels: a stage's name, a row's key (the one below 7:1)" },
  { text: "--error-on-ink", ground: "--ink-deep", where: "a check-in that failed, a job whose queue stopped" },
  { text: "--ink-deep", ground: "--gilt", where: "the one primary action" },
  { text: "--ink-deep", ground: "--paper", where: "the offline banner, a ticked box (ADR 0025, item 59)" },
  { text: "--ink-tag", ground: "--ink-disabled", where: "an action not usable yet" },
  { text: "--paper", ground: "--ink-frame", where: "the capture screen, when the camera will not open" },
  { text: "--ink-soft", ground: "--ink-frame", where: "the capture guide, an angle not taken yet" },
  { text: "--paper", ground: "--ink-raised", where: "an angle taken, a chosen outcome" },
];

/** Grounds that never carry a word: the upload bar's track, and the scrim behind a confirmation. */
const WORDLESS_GROUNDS = new Set(["--ink-rule", "--ink-night"]);

interface EdgePairing {
  readonly edge: string;
  readonly ground: string;
  readonly where: string;
}

/**
 * The edges that show a control is there, which WCAG 1.4.11 holds to 3:1 against its ground. The boards draw
 * them in --ink-line, 2:1 on the ink and too faint in the sun, so the app draws them in --ink-line-strong.
 */
const EDGE_PAIRINGS: readonly EdgePairing[] = [
  {
    edge: "--ink-line-strong",
    ground: "--ink-deep",
    where: "a field, a box of the sign-in code, a checklist box not yet ticked, a piece to pick",
  },
  { edge: "--paper", ground: "--ink-deep", where: "the label's field, a ticked box" },
];

/** The controls the edge pairings speak for, each by its stylesheet and its rule. */
const CONTROLS = [
  { file: "apps/tech/src/login/login.module.css", selector: ".mobile" },
  { file: "apps/tech/src/login/login.module.css", selector: ".box" },
  { file: "apps/tech/src/steps/steps.module.css", selector: ".box" },
  { file: "apps/tech/src/steps/steps.module.css", selector: ".boxDone" },
  { file: "apps/tech/src/steps/steps.module.css", selector: ".box64" },
  { file: "apps/tech/src/steps/steps.module.css", selector: ".labelField" },
  { file: "apps/tech/src/steps/steps.module.css", selector: ".pick" },
] as const;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/**
 * The shared buttons this app draws (packages/ui/Button.tsx): gold for the one
 * action, outlined on ink for the others. Their rules are read with the app's own.
 */
const SHARED_BUTTONS = { file: "packages/ui/button.module.css", looks: [".gold", ".outlineOnInk"] } as const;

/** The app's own rules, and the shared buttons' rules for the looks it draws. */
function rulesDrawn(): [string, string][] {
  const shared = rulesOf(SHARED_BUTTONS.file).filter(([selector]) =>
    SHARED_BUTTONS.looks.some((look) => selector.includes(look)),
  );
  return [...stylesheets("apps/tech/src").flatMap(rulesOf), ...shared];
}

/** Every token each rule sets as a text colour and as a ground, and the rules that set both. */
function coloursUsed(): { texts: Set<string>; grounds: Set<string>; both: [string, string, string][] } {
  const texts = new Set<string>();
  const grounds = new Set<string>();
  const both: [string, string, string][] = [];
  for (const [selector, body] of rulesDrawn()) {
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
    if (text !== null && ground !== null) both.push([selector, text, ground]);
  }
  return { texts, grounds, both };
}

function ratioOf(pairing: Pairing): number {
  return tokenRatio(pairing.text, pairing.ground);
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

describe("the technician app's control edges", () => {
  it.each(EDGE_PAIRINGS.map((pairing) => [`${pairing.edge} on ${pairing.ground}`, pairing] as const))(
    "%s clears 3:1",
    (_name, pairing) => {
      expect(tokenRatio(pairing.edge, pairing.ground)).toBeGreaterThanOrEqual(3);
    },
  );

  it("does not use the boards' --ink-line, which falls short of 3:1 on the ink", () => {
    expect(tokenRatio("--ink-line", "--ink-deep")).toBeLessThan(3);
    expect(EDGE_PAIRINGS.map((pairing) => pairing.edge)).not.toContain("--ink-line");
  });

  it.each(CONTROLS.map((control) => [`${control.selector} in ${control.file}`, control] as const))(
    "edges %s in a colour the edge pairings list",
    (_name, control) => {
      const listed = EDGE_PAIRINGS.map((pairing) => pairing.edge);
      expect(listed).toContain(edgeOf(control.file, control.selector));
    },
  );
});

describe("what the stylesheets use", () => {
  const used = coloursUsed();

  it("reads every stylesheet's colours, so the checks below check something", () => {
    expect(used.texts.size).toBeGreaterThanOrEqual(6);
    expect(used.both.length).toBeGreaterThanOrEqual(5);
    expect(used.both).toContainEqual([".gold", "--ink-deep", "--gilt"]);
    expect(used.both).toContainEqual([".outlineOnInk:disabled", "--ink-tag", "--ink-disabled"]);
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
