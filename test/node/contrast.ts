// What the contrast tests share: the brand's colour tokens, WCAG's contrast
// ratio, and a stylesheet read as its rules.

import { readFileSync } from "node:fs";

const TOKENS = new Map(
  ["packages/brand/tokens.css", "packages/brand/tokens-apps.css"].flatMap((file) =>
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

/** WCAG's contrast ratio between two colours, given as hex. */
export function ratio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The colour roles (packages/brand/tokens.css), each as the palette token it aliases on paper and on the ink. */
function rolesIn(selector: string): Map<string, string> {
  const css = readFileSync("packages/brand/tokens.css", "utf8");
  const start = css.lastIndexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)/g)].map(([, role = "", token = ""]) => [role, token]),
  );
}

const ROLES = { paper: rolesIn(":root"), ink: rolesIn('[data-ground="ink"]') };
const INK_GROUNDS = new Set(["--ink", "--ink-deep", "--ink-night"]);

/** WCAG's contrast ratio between two of the brand's tokens, given by name; a role is read as it is on that ground. */
export function tokenRatio(first: string, second: string): number {
  const roles = INK_GROUNDS.has(second) ? ROLES.ink : ROLES.paper;
  const firstHex = TOKENS.get(roles.get(first) ?? first);
  const secondHex = TOKENS.get(second);
  if (firstHex === undefined || secondHex === undefined) throw new Error(`${first} or ${second} is no token`);
  return ratio(firstHex, secondHex);
}

/** Each rule of a stylesheet, as its selector and its declarations; a rule inside a layer or a query counts too. */
export function rulesOf(file: string): [string, string][] {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => [selector.trim(), body]);
}

/** A rule's declarations, as [property, value]. */
function declarationsIn(body: string): [string, string][] {
  const declarations: [string, string][] = [];
  for (const declaration of body.split(";")) {
    const [property = "", value = ""] = declaration.split(/:(.*)/s).map((part) => part.trim());
    if (property !== "") declarations.push([property, value]);
  }
  return declarations;
}

/** Whether a rule's selector list, such as ".box,\n.boxDone", names this one selector. */
function names(selectorList: string, selector: string): boolean {
  return selectorList.split(",").some((part) => part.trim() === selector);
}

/** Every declaration the rules naming one selector make, in the stylesheet's order. */
export function declarationsOf(file: string, selector: string): [string, string][] {
  const rules = rulesOf(file).filter(([selectorList]) => names(selectorList, selector));
  if (rules.length === 0) throw new Error(`${file} has no rule for ${selector}`);
  return rules.flatMap(([, body]) => declarationsIn(body));
}

/** The token a selector's border is drawn in. The last one set wins, as it does in the browser. */
export function edgeOf(file: string, selector: string): string {
  let edge: string | null = null;
  for (const [property, value] of declarationsOf(file, selector)) {
    if (property === "border") edge = /solid var\((--[\w-]+)\)/.exec(value)?.[1] ?? edge;
    if (property === "border-color") edge = /^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? edge;
  }
  if (edge === null) throw new Error(`${selector} in ${file} draws no edge`);
  return edge;
}
