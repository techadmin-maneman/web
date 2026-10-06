// The apps' one button (packages/ui/Button.tsx): every look it has answers a
// press, a pointer resting on it, being unusable and being busy, which no
// button of the three apps did before. A busy button says so to a
// screen reader; that a second tap does nothing is test/dom/ui-button.test.ts.
// A screen's own class places a button and never colours it, since a class of
// the app's own wins over every look here and would erase them.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink, BUTTON_VARIANTS } from "../../packages/ui/Button.tsx";

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  readonly selectors: string[];
  readonly declarations: string[];
}

/** Each rule of a stylesheet; a rule inside a layer or a query counts too. */
function rulesOf(css: string): Rule[] {
  return [...withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, selectors = "", body = ""]) => ({
    selectors: selectors.split(",").map((selector) => selector.trim()),
    declarations: body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== ""),
  }));
}

const css = withoutComments(readFileSync("packages/ui/button.module.css", "utf8"));
const buttonRules = rulesOf(css);

/** The selectors of every rule in the stylesheet, one string each. */
const selectors = buttonRules.map((rule) => rule.selectors.join(", "));

/** The declarations of the rule for exactly this selector. */
function declarationsOf(selector: string): string[] {
  return buttonRules.find((rule) => rule.selectors.includes(selector))?.declarations ?? [];
}

describe.each(BUTTON_VARIANTS)("the %s button", (variant) => {
  it("shows it is pressed", () => {
    expect(selectors.some((selector) => selector.includes(`.${variant}:active`))).toBe(true);
  });

  it("shows a pointer resting on it, where there is a pointer to rest", () => {
    expect(css).toMatch(/@media \(hover: hover\)/);
    expect(selectors.some((selector) => selector.includes(`.${variant}:hover`))).toBe(true);
  });

  it("looks unusable when it is", () => {
    expect(selectors.some((selector) => selector.includes(`.${variant}:disabled`))).toBe(true);
  });
});

describe("an unusable button on ink", () => {
  it("looks one way, whichever look it has", () => {
    const looks = [".light", ".gold", ".outlineOnInk"].map((look) =>
      declarationsOf(`${look}:disabled`).filter((declaration) => /^(background|color)\s*:/.test(declaration)),
    );
    expect(looks[0]).toEqual(["background: var(--ink-disabled)", "color: var(--ink-tag)"]);
    expect(looks[1]).toEqual(looks[0]);
    expect(looks[2]).toEqual(looks[0]);
  });
});

describe("a busy button", () => {
  it("says it is busy", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "primary", size: "action", busy: true }, "Pay"),
    );
    expect(markup).toContain('aria-busy="true"');
  });

  it("looks busy on a phone, which shows no cursor", () => {
    expect(declarationsOf('.button[aria-busy="true"]:not(:disabled)')).toContain("opacity: var(--busy-opacity)");
  });

  it("says nothing of it when it is not", () => {
    const markup = renderToStaticMarkup(createElement(Button, { variant: "primary", size: "action" }, "Pay"));
    expect(markup).not.toContain("aria-busy");
  });
});

describe("a button", () => {
  it("submits nothing unless asked to", () => {
    const markup = renderToStaticMarkup(createElement(Button, { variant: "outline", size: "small" }, "Try again"));
    expect(markup).toContain('type="button"');
  });

  it("can be a link drawn as a button, with the same look", () => {
    const button = renderToStaticMarkup(createElement(Button, { variant: "outline", size: "small" }, "x"));
    const link = renderToStaticMarkup(createElement(ButtonLink, { variant: "outline", size: "small", href: "/" }, "x"));
    const classOf = (markup: string) => /class="([^"]*)"/.exec(markup)?.[1];
    expect(classOf(link)).toBe(classOf(button));
    expect(link).toContain('href="/"');
  });
});

/** The components that hand the class they are given to a button: the shared two, and the client app's own. */
const HANDS_ITS_CLASS_TO_A_BUTTON = new Set(["Button", "ButtonLink", "BookButton", "BookNext", "LogOut"]);

/** What a class handed to a button may not set: each draws one of its looks. */
const LOOK_PROPERTIES = new Set(["background", "background-color", "color", "border", "border-color"]);

/** The classes that do, each for a look its board draws. */
const DRAWN_BY_A_BOARD = new Set([
  // Reschedule offline, in the visit card's own quiet words.
  "apps/app/src/home/home.module.css .action",
  // The profile's outlined buttons, and the photograph's Close, edged in the paper's own line.
  "apps/app/src/profile/profile.module.css .secondary",
  "apps/app/src/profile/profile.module.css .logout",
  "apps/app/src/photos/photos.module.css .close",
  // The technician's answer that can cost the client, edged in the error's colour.
  "apps/tech/src/components/sheet.module.css .yes",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const COMPONENTS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "packages/ui"].flatMap(sourceFiles).map(parse);

/** Each stylesheet a component imports, by the name it imports it as: `styles` for "./home.module.css". */
function stylesheetsOf(source: ts.SourceFile): Map<string, string> {
  const stylesheets = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const name = statement.importClause?.name?.text;
    if (from.endsWith(".module.css") && name !== undefined) {
      stylesheets.set(name, join(dirname(source.fileName), from).replace(/\\/g, "/"));
    }
  }
  return stylesheets;
}

/** The value an element gives its className, unless it is drawn quietly, as a link rather than a button. */
function classNameGiven(element: ts.JsxOpeningElement | ts.JsxSelfClosingElement): ts.Expression | undefined {
  const attributes = element.attributes.properties.filter(ts.isJsxAttribute);
  if (attributes.some((attribute) => attribute.name.getText() === "quiet")) return undefined;
  const className = attributes.find((attribute) => attribute.name.getText() === "className")?.initializer;
  return className !== undefined && ts.isJsxExpression(className) ? className.expression : undefined;
}

/** What a button is handed as its class: a JSX button's className, or buttonLook()'s for a link drawn as one. */
function classesHanded(node: ts.Node): ts.Expression | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return HANDS_ITS_CLASS_TO_A_BUTTON.has(node.tagName.getText()) ? classNameGiven(node) : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.getText() === "buttonLook") {
    const [look] = node.arguments;
    if (look === undefined || !ts.isObjectLiteralExpression(look)) return undefined;
    const properties = look.properties.filter(ts.isPropertyAssignment);
    return properties.find((property) => property.name.getText() === "className")?.initializer;
  }
  return undefined;
}

/** Each node beneath this one, and it. */
function everyNode(node: ts.Node): ts.Node[] {
  const beneath: ts.Node[] = [];
  node.forEachChild((child) => {
    beneath.push(...everyNode(child));
  });
  return [node, ...beneath];
}

/** Every class a component hands a button, as "stylesheet .class", from `styles.book` and the like. */
function classesHandedToButtons(source: ts.SourceFile): string[] {
  const stylesheets = stylesheetsOf(source);
  return everyNode(source).flatMap((node) => {
    const handed = classesHanded(node);
    if (handed === undefined) return [];
    return everyNode(handed).flatMap((part) => {
      if (!ts.isPropertyAccessExpression(part) || !ts.isIdentifier(part.expression)) return [];
      const stylesheet = stylesheets.get(part.expression.text);
      return stylesheet === undefined ? [] : [`${stylesheet} .${part.name.text}`];
    });
  });
}

/** Whether the selector picks out the element with the class itself, rather than something inside it. */
function picksOut(selector: string, name: string): boolean {
  const compounds = selector.split(/[\s>+~]+/);
  const subject = compounds[compounds.length - 1] ?? "";
  return new RegExp(`\\.${name}(?![\\w-])`).test(subject);
}

/** What the class sets of a button's look, in any rule that picks out the button by it. */
function looksSet(handed: string): string[] {
  const [stylesheet = "", name = ""] = handed.split(" .");
  return rulesOf(readFileSync(stylesheet, "utf8"))
    .filter((rule) => rule.selectors.some((selector) => picksOut(selector, name)))
    .flatMap((rule) => rule.declarations)
    .filter((declaration) => LOOK_PROPERTIES.has(declaration.split(":")[0]?.trim() ?? ""));
}

/** The components that pass on the className they were given to a button, by name. */
function componentsPassingTheirClassOn(source: ts.SourceFile): string[] {
  return everyNode(source).flatMap((node) => {
    const handed = classesHanded(node);
    if (handed === undefined || !ts.isIdentifier(handed) || handed.text !== "className") return [];
    const owner = ts.findAncestor(node, ts.isFunctionDeclaration);
    return [owner?.name?.text ?? "an unnamed component"];
  });
}

describe("a class an app hands a button", () => {
  const handed = [...new Set(COMPONENTS.flatMap(classesHandedToButtons))];

  it("is found wherever an app hands one", () => {
    expect(handed).toContain("apps/app/src/home/home.module.css .book");
    expect(handed).toContain("apps/app/src/home/home.module.css .action");
  });

  it.each(handed.filter((each) => !DRAWN_BY_A_BOARD.has(each)))("%s places it and never colours it", (each) => {
    expect(looksSet(each)).toEqual([]);
  });

  it("is read through every component that passes its class on to a button", () => {
    const passing = COMPONENTS.flatMap(componentsPassingTheirClassOn);
    expect(passing.filter((name) => !HANDS_ITS_CLASS_TO_A_BUTTON.has(name))).toEqual([]);
  });
});
