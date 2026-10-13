// Every control is drawn by the shared package (packages/ui): a button, a link, a field, a choice, a fold. An app or
// a site island that draws its own <button> or <input> draws a look of its own beside the shared one, so neither
// stays the house's. An Astro page renders no component of the shared package's, so its raw element takes the shared
// look instead: buttonLook(), textLinkLook(), iconButtonLook() or the ruled disclosure's classes.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOTS = ["apps/ops/src", "apps/app/src", "apps/tech/src", "site/src"];
const CONTROLS = ["a", "button", "input", "select", "textarea", "label", "fieldset", "legend", "details", "summary"];
const OTHERS = ["table", "dialog", "progress", "meter"];
const TAG = new RegExp(`<(${[...CONTROLS, ...OTHERS].join("|")})(?=[\\s>/])`, "g");
const SHARED_LOOK = /^<\w+\s[^>]*?\bclass=\{(buttonLook|textLinkLook|iconButtonLook|ruled\.\w+)\b/s;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return /\.(tsx|astro)$/.test(entry.name) ? [path] : [];
  });
}

/** The file without its comments, so a comment that names an element is not one. */
const withoutComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

/** Each raw element's opening tag, up to the > that closes it outside any {expression}. */
function openingTags(text: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  for (const match of text.matchAll(TAG)) {
    let depth = 0;
    let end = match.index;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    found.push({ tag: text.slice(match.index, end + 1), line: text.slice(0, match.index).split("\n").length });
  }
  return found;
}

function rawControls(): string[] {
  return ROOTS.flatMap(filesUnder).flatMap((file) => {
    const astro = file.endsWith(".astro");
    return openingTags(withoutComments(readFileSync(file, "utf8")))
      .filter(({ tag }) => !(astro && SHARED_LOOK.test(tag)))
      .map(({ tag, line }) => `${file}:${String(line)} ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
  });
}

describe("the controls the apps and the site draw", () => {
  it("are the shared package's, or on an Astro page take its look", () => {
    expect(rawControls()).toEqual([]);
  });

  it("would catch one that is not", () => {
    const tags = openingTags(`<div><button type="button">Go</button><a class={buttonLook({ variant: "primary" })}>`);
    expect(tags.map(({ tag }) => SHARED_LOOK.test(tag))).toEqual([false, true]);
  });
});
