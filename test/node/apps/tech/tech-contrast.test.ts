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
import { edgeOf, hexOf, ratio, rolesIn, rulesOf, tokenRatio } from "../../contrast.ts";

interface Pairing {
  readonly text: string;
  readonly ground: string;
  readonly where: string;
}

const PAIRINGS: readonly Pairing[] = [
  { text: "--paper", ground: "--ink-deep", where: "every screen’s words" },
  { text: "--ink-soft", ground: "--ink-deep", where: "a line beneath a heading, access notes, a caution" },
  { text: "--ink-muted", ground: "--ink-deep", where: "labels: a stage’s name, a row’s key (the one below 7:1)" },
  { text: "--paper-shade", ground: "--ink-deep", where: "the stage a job card is at, read in sunlight" },
  { text: "--error-on-ink", ground: "--ink-deep", where: "a check-in that failed, a job whose queue stopped" },
  { text: "--ink-deep", ground: "--gilt", where: "the one primary action" },
  { text: "--ink-deep", ground: "--paper", where: "the offline banner, a ticked box (ADR 0025, item 59)" },
  { text: "--ink-tag", ground: "--ink-disabled", where: "an action not usable yet" },
  { text: "--paper", ground: "--ink-frame", where: "the capture screen, when the camera will not open" },
  { text: "--ink-soft", ground: "--ink-frame", where: "the capture guide, an angle not taken yet" },
  { text: "--paper", ground: "--ink-raised", where: "an angle taken, a chosen outcome" },
];

/**
 * The new look (apps/tech/src/styles/look.css; docs/decisions/0239-technician-light-look.md), held to the redesign
 * brief's own rule: "Text contrast 4.5:1 minimum" (docs/prompts/tech-redesign.md). Its screens are drawn on white
 * rather than the ink, so the older screens' 5.8:1 is not theirs.
 */
const LIGHT_PAIRINGS: readonly Pairing[] = [
  { text: "--ink-900", ground: "--white-000", where: "every redrawn screen’s words" },
  { text: "--ink-500", ground: "--white-000", where: "a line beneath a title, a label, a helper line" },
  { text: "--navy-900", ground: "--white-000", where: "titles, a section’s head, a link, a stepper’s key" },
  { text: "--gold-700", ground: "--white-000", where: "the one highlight in words: “Next · leave in 10 min”" },
  { text: "--error", ground: "--white-000", where: "an error, a problem’s title, an alert" },
  { text: "--white-000", ground: "--navy-900", where: "the primary action, a chosen chip, the no-signal bar" },
  { text: "--white-000", ground: "--navy-700", where: "the primary action, pressed" },
  { text: "--ink-500", ground: "--disabled", where: "an action not usable yet" },
  { text: "--ink-900", ground: "--grid-100", where: "a problem card’s words under a pointer" },
  { text: "--error", ground: "--grid-100", where: "a problem card’s title under a pointer" },
  { text: "--error", ground: "--disabled", where: "an action that takes something away, pressed" },
  { text: "--ink-900", ground: "--disabled", where: "a person’s initials" },
  { text: "--white-000", ground: "--error", where: "a destructive action" },
];

/** The roles the new look gives the shared parts, each as the brief's colour it takes. */
const LOOK_ROLES = rolesIn("apps/tech/src/styles/look.css", '[data-look="light"]');
const inLook = (token: string) => LOOK_ROLES.get(token) ?? token;

/** The new look's control edges, at 3:1 on its white: a field's, a box's, a stepper's key's, and one chosen or refused. */
const LIGHT_EDGES: readonly EdgePairing[] = [
  { edge: "--stone", ground: "--white-000", where: "a field, a box to tick, a radio, a stepper’s key, a chip" },
  { edge: "--navy-900", ground: "--white-000", where: "a field being typed in, a box ticked, a chip chosen" },
  { edge: "--error", ground: "--white-000", where: "a field refused, a problem card" },
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
  { edge: "--paper", ground: "--ink-deep", where: "the label’s field, a ticked box" },
  // A role, read as the ink's: the shared code field's boxes.
  { edge: "--border-control", ground: "--ink-deep", where: "a box of the sign-in code" },
];

/**
 * The controls the edge pairings speak for, each by its stylesheet and its rule: the shared ones the app draws on the
 * ink (the sign-in number, a code's box, a checklist's box, a field).
 */
const CONTROLS = [
  { file: "packages/ui/mobile-input.module.css", selector: ".onInk" },
  { file: "packages/ui/code-field.module.css", selector: ".box" },
  { file: "packages/ui/check-row.module.css", selector: ".box" },
  { file: "packages/ui/check-row.module.css", selector: ".boxDone" },
  { file: "packages/ui/field.module.css", selector: ".onInk" },
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

/**
 * The screens redrawn in the new look, which carry data-look="light", and the look itself. Each redesign PR adds the
 * folders of the screens it redraws; their colours are read as the look sets them and held to its 4.5:1.
 */
const REDRAWN = ["apps/tech/src/parts/", "apps/tech/src/styles/look.css"];
const slashed = (file: string) => file.replace(/\\/g, "/");
const isRedrawn = (file: string) => REDRAWN.some((place) => slashed(file).startsWith(place));

/** The older screens' rules on the ink, with the shared buttons' rules for the looks they draw. */
function inkRules(): [string, string][] {
  const shared = rulesOf(SHARED_BUTTONS.file).filter(([selector]) =>
    SHARED_BUTTONS.looks.some((look) => selector.includes(look)),
  );
  const own = stylesheets("apps/tech/src").filter((file) => !isRedrawn(file));
  return [...own.flatMap(rulesOf), ...shared];
}

/** The redrawn screens' rules. */
const lightRules = (): [string, string][] => stylesheets("apps/tech/src").filter(isRedrawn).flatMap(rulesOf);

/** Every token each rule sets as a text colour and as a ground, and the rules that set both. */
function coloursUsed(rules: [string, string][]): {
  texts: Set<string>;
  grounds: Set<string>;
  both: [string, string, string][];
} {
  const texts = new Set<string>();
  const grounds = new Set<string>();
  const both: [string, string, string][] = [];
  for (const [selector, body] of rules) {
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

describe("the technician app’s colour pairings", () => {
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

  it("draws the disabled action at 7:1 or better, which the board’s own pair is not", () => {
    expect(ratio("#a8b2c2", "#2a3a56")).toBeLessThan(5.8);
    expect(ratioOf({ text: "--ink-tag", ground: "--ink-disabled", where: "" })).toBeGreaterThanOrEqual(7);
  });
});

describe("the new look’s colour pairings", () => {
  it.each(LIGHT_PAIRINGS.map((pairing) => [`${pairing.text} on ${pairing.ground}`, pairing] as const))(
    "%s clears 4.5:1",
    (_name, pairing) => {
      expect(ratioOf(pairing)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(LIGHT_EDGES.map((pairing) => [`${pairing.edge} on ${pairing.ground}`, pairing] as const))(
    "edges a control in %s, which clears 3:1",
    (_name, pairing) => {
      expect(tokenRatio(pairing.edge, pairing.ground)).toBeGreaterThanOrEqual(3);
    },
  );

  it("does not edge a control in the brief’s --line-200, which falls short of 3:1, but in --stone", () => {
    expect(tokenRatio("--line-200", "--white-000")).toBeLessThan(3);
    expect(inLook("--ui-line-control")).toBe("--stone");
    expect(inLook("--border-control")).toBe("--stone");
  });

  it("gives the shared parts' words and grounds only colours its pairings list", () => {
    const texts = new Set(LIGHT_PAIRINGS.map((pairing) => pairing.text));
    const grounds = new Set(LIGHT_PAIRINGS.map((pairing) => pairing.ground));
    const words = ["--ui-text", "--ui-text-soft", "--ui-text-muted", "--ui-text-quiet", "--ui-hint", "--ui-strong"];
    const under = ["--ui-ground", "--ui-raised", "--ui-box", "--ui-shade", "--ui-tint", "--ui-strong"];
    expect(words.map(inLook).filter((token) => !texts.has(token))).toEqual([]);
    expect(under.map(inLook).filter((token) => !grounds.has(token))).toEqual([]);
    expect([inLook("--ui-on-strong"), inLook("--ui-strong")]).toEqual(["--white-000", "--navy-900"]);
  });
});

describe("the technician app’s control edges", () => {
  it.each(EDGE_PAIRINGS.map((pairing) => [`${pairing.edge} on ${pairing.ground}`, pairing] as const))(
    "%s clears 3:1",
    (_name, pairing) => {
      expect(tokenRatio(pairing.edge, pairing.ground)).toBeGreaterThanOrEqual(3);
    },
  );

  // A piece to pick, and every other outlined button and toggle on the ink, takes the app's own edge.
  it("edges the shared outlines on the ink in --ink-line-strong, as every app does", () => {
    expect(readFileSync("packages/ui/base.css", "utf8")).toMatch(/--edge-on-ink: var\(--ink-line-strong\);/);
  });

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

describe("what the older screens’ stylesheets use", () => {
  const used = coloursUsed(inkRules());

  it("reads every stylesheet’s colours, so the checks below check something", () => {
    expect(used.texts.size).toBeGreaterThanOrEqual(6);
    expect(used.both.length).toBeGreaterThanOrEqual(5);
    expect(used.both).toContainEqual([".gold", "--ink-deep", "--gilt"]);
    const firstSelector = used.both.map(([selector, text, ground]) => [selector.split(",")[0], text, ground]);
    expect(firstSelector).toContainEqual([".outlineOnInk:disabled", "--ink-tag", "--ink-disabled"]);
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
    expect(used.both.filter(([, text, ground]) => !listed.has(`${text} on ${ground}`))).toEqual([]);
  });
});

/** The brief's own colours: packages/brand/tokens.css, under "the technician app's light ground". */
function briefColours(): Set<string> {
  const css = readFileSync("packages/brand/tokens.css", "utf8");
  const block = /technician app's light ground[\s\S]*?(?=\/\* ----)/.exec(css)?.[0] ?? "";
  return new Set([...block.matchAll(/(--[\w-]+):/g)].map((match) => match[1] ?? ""));
}

const COLOUR_PROPERTY = /^(color|background(-color)?|border(-[a-z]+)*|outline(-color)?|fill|stroke|box-shadow)$/;
/** Sizes a colour declaration may name beside its colour: a border's width. */
const NOT_A_COLOUR = /^--(hairline|rule-strong|focus-[\w-]+)$/;

describe("what the redrawn screens use", () => {
  const used = coloursUsed(lightRules());

  it("knows which screens are redrawn: every one that takes the new look", () => {
    const screens = readdirSync("apps/tech/src", { recursive: true, encoding: "utf8" })
      .map((file) => slashed(join("apps/tech/src", file)))
      .filter((file) => file.endsWith(".tsx") && readFileSync(file, "utf8").includes('data-look="light"'));
    expect(screens.length).toBeGreaterThan(0);
    expect(screens.filter((file) => !isRedrawn(file))).toEqual([]);
  });

  it("rounds corners only as the look does, a circle aside, and draws no shadow", () => {
    expect([inLook("--ui-radius-button"), inLook("--ui-radius-box")]).toEqual(["--sp-4", "--sp-2"]);
    const outside = lightRules().flatMap(([selector, body]) =>
      body.split(";").flatMap((declaration) => {
        const [property = "", value = ""] = declaration.split(/:(.*)/s).map((part) => part.trim());
        if (property.endsWith("radius") && !/^(0|50%|var\(--ui-radius-(button|box)\))$/.test(value)) {
          return [`${selector} ${property}: ${value}`];
        }
        return property === "box-shadow" && value !== "none" ? [`${selector} box-shadow: ${value}`] : [];
      }),
    );
    expect(outside).toEqual([]);
  });

  it("draws only in the brief's colours and the look's roles", () => {
    const brief = briefColours();
    expect(brief.has("--navy-900")).toBe(true);
    const allowed = new Set([...brief, ...LOOK_ROLES.keys()]);
    const outside = lightRules().flatMap(([selector, body]) =>
      body.split(";").flatMap((declaration) => {
        const [property = "", value = ""] = declaration.split(/:(.*)/s).map((part) => part.trim());
        if (!COLOUR_PROPERTY.test(property)) return [];
        return [...value.matchAll(/var\((--[\w-]+)/g)]
          .map((match) => match[1] ?? "")
          .filter((token) => !allowed.has(token) && !NOT_A_COLOUR.test(token))
          .map((token) => `${selector} ${property}: ${token}`);
      }),
    );
    expect(outside).toEqual([]);
  });

  it("sets each text colour and ground, read as the look sets them, as the new look's pairings list them", () => {
    const texts = new Set(LIGHT_PAIRINGS.map((pairing) => pairing.text));
    const grounds = new Set(LIGHT_PAIRINGS.map((pairing) => pairing.ground));
    const listed = new Set(LIGHT_PAIRINGS.map((pairing) => `${pairing.text} on ${pairing.ground}`));
    expect([...used.texts].filter((token) => !texts.has(inLook(token)))).toEqual([]);
    expect([...used.grounds].filter((token) => !grounds.has(inLook(token)))).toEqual([]);
    expect(used.both.filter(([, text, ground]) => !listed.has(`${inLook(text)} on ${inLook(ground)}`))).toEqual([]);
  });
});

/** A colour as sRGB's three channels, 0 to 255. */
const channelsOf = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** `share` of one colour over another, as CSS's color-mix(in srgb, …) mixes them. */
function mixed(over: string, share: number, under: string): string {
  const bottom = channelsOf(under);
  const mix = channelsOf(over).map((value, at) => Math.round(value * share + (bottom[at] ?? 0) * (1 - share)));
  return `#${mix.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

describe("the shared parts in the new look", () => {
  // Each rule of packages/ui that sets its words and its ground both in roles the look sets.
  const both = readdirSync("packages/ui")
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) => coloursUsed(rulesOf(`packages/ui/${file}`)).both.map((rule) => [file, ...rule] as const))
    .filter(([, , text, ground]) => LOOK_ROLES.has(text) && LOOK_ROLES.has(ground));

  it("reads the shared parts' pairs, so the check below checks something", () => {
    expect(both.length).toBeGreaterThanOrEqual(3);
  });

  it("pairs each shared part's words and ground, as the look sets them, as the new look's pairings list them", () => {
    const listed = new Set(LIGHT_PAIRINGS.map((pairing) => `${pairing.text} on ${pairing.ground}`));
    const unlisted = both
      .filter(([, , text, ground]) => !listed.has(`${inLook(text)} on ${inLook(ground)}`))
      .map(([file, selector, text, ground]) => `${file} ${selector}: ${inLook(text)} on ${inLook(ground)}`);
    expect(unlisted).toEqual([]);
  });

  // A badge's ground is its own tone at 12% over the raised ground (packages/ui/badge.module.css).
  it.each(["--on-surface-muted", "--status-done", "--status-attention", "--status-warning", "--status-error"])(
    "draws a %s badge at 4.5:1 or better on its own tint",
    (role) => {
      const tone = hexOf(inLook(role));
      expect(ratio(tone, mixed(tone, 0.12, hexOf(inLook("--ui-raised"))))).toBeGreaterThanOrEqual(4.5);
    },
  );
});
