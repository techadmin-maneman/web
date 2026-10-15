// The words the browser tests look for, against the words the surfaces show: every string in the content modules,
// by where it lives, and every string a test finds or asserts by (getByRole's name, getByText, toHaveText, hasText and
// the like, and a file's own constants). A test that looks for copy names it from its module, so a copy pass changes
// the test with the screen. Used by ./e2e-copy.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type Surface = "app" | "ops" | "tech" | "site";

/** Each surface's content modules, and the barrel that re-exports them where there is one. */
export const CONTENT: Readonly<Record<Surface, { readonly folders: readonly string[]; readonly barrel?: string }>> = {
  app: { folders: ["apps/app/src/content", "packages/web-kit/client-words.ts"], barrel: "apps/app/src/content.ts" },
  ops: { folders: ["apps/ops/src/content"], barrel: "apps/ops/src/content.ts" },
  tech: { folders: ["apps/tech/src/content.ts"] },
  site: { folders: ["site/src/content", "site/src/content/site"], barrel: "site/src/content/site.ts" },
};

export interface CopyString {
  /** The module that holds it, from the repository's root. */
  readonly module: string;
  readonly exportName: string;
  readonly path: readonly string[];
  readonly value: string;
}

export function contentModules(surface: Surface): string[] {
  return CONTENT[surface].folders.flatMap((folder) =>
    folder.endsWith(".ts")
      ? [folder]
      : readdirSync(folder)
          .filter((name) => name.endsWith(".ts"))
          .map((name) => `${folder}/${name}`),
  );
}

/**
 * Copy kept in tables by a code (a setting's key, an error's code): typed by the code, so TypeScript cannot promise a
 * test that a code it names has words. A test may name these by their words.
 */
const KEYED = [
  "booking.pay.code.errors",
  "oneVisit.code.errors",
  "rules.keyNames",
  "rules.choiceNames",
  "needsAHand.kinds",
  "notices.photo.layout",
  "photo.layout",
];

/** Every string a module's exports hold in their objects, however deep; none a function makes, nor a list holds. */
export function stringsOf(module: string, exports: Readonly<Record<string, unknown>>): CopyString[] {
  const found: CopyString[] = [];
  const walk = (exportName: string, value: unknown, at: string[], seen: Set<unknown>) => {
    if (typeof value === "string") {
      const where = [exportName, ...at].join(".");
      const keyed = KEYED.some((table) => `.${where}`.includes(`.${table}.`));
      if (value.trim().length > 1 && !keyed) found.push({ module, exportName, path: at, value });
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value) || seen.has(value)) return;
    seen.add(value);
    for (const [key, each] of Object.entries(value)) walk(exportName, each, [...at, key], seen);
  };
  for (const [name, value] of Object.entries(exports)) walk(name, value, [], new Set());
  return found;
}

/** The modules a barrel re-exports whole, from its `export * from` lines. */
export function reExported(barrel: string): string[] {
  const text = readFileSync(barrel, "utf8");
  return [...text.matchAll(/^export \* from "(\.[^"]+)";$/gm)].map((match) =>
    path.posix.join(path.posix.dirname(barrel), match[1] ?? ""),
  );
}

/** The calls whose first argument a test finds or asserts by. */
const BY_FIRST = new Set([
  "getByLabel",
  "getByText",
  "getByPlaceholder",
  "getByTitle",
  "getByAltText",
  "toHaveText",
  "toContainText",
  "toHaveAccessibleName",
  "toHaveAccessibleDescription",
]);

export interface Literal {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

const isText = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

function textsIn(node: ts.Expression | undefined): ts.StringLiteral[] {
  if (node === undefined) return [];
  if (isText(node)) return [node as ts.StringLiteral];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((each) => textsIn(each));
  return [];
}

/** The string literals a test file finds or asserts by, and the strings its top-level constants are. */
export function literalsIn(file: string, text: string = readFileSync(file, "utf8")): Literal[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: ts.StringLiteral[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) found.push(...textsIn(declaration.initializer));
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const called = node.expression.name.text;
      if (BY_FIRST.has(called)) found.push(...textsIn(node.arguments[0]));
      const options = node.arguments[1];
      if (called === "getByRole" && options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(source) === "name") {
            found.push(...textsIn(property.initializer));
          }
        }
      }
    }
    if (ts.isPropertyAssignment(node) && ["hasText", "hasNotText"].includes(node.name.getText(source))) {
      found.push(...textsIn(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const unique = new Map(found.map((literal) => [literal.getStart(source), literal]));
  return [...unique.values()].map((literal) => ({
    start: literal.getStart(source),
    end: literal.getEnd(),
    value: literal.text,
  }));
}

/** The surface each folder of e2e/ tests; a test at its top is the site's. */
const FOLDERS: Readonly<Record<string, Surface>> = {
  app: "app",
  ops: "ops",
  tech: "tech",
  "tech-live": "tech",
  "tech-staging": "tech",
};

/** The surfaces a browser test's words come from: its folder's, and any whose content it imports already. */
export function surfacesOf(file: string, text: string): Surface[] {
  const own = FOLDERS[file.split("/")[1] ?? ""] ?? "site";
  const imported = (Object.keys(CONTENT) as Surface[]).filter((surface) =>
    [...CONTENT[surface].folders, CONTENT[surface].barrel ?? "\0"].some((place) =>
      text.includes(place.replace(/\.ts$/, "")),
    ),
  );
  return [...new Set([own, ...imported])];
}

export function browserTests(directory = "e2e"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const at = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return browserTests(at);
    return at.endsWith(".ts") ? [at] : [];
  });
}
