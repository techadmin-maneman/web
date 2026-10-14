// Every write Settings makes goes the one way (docs/decisions/0071-what-ops-see-before-a-setting-changes.md): sent
// from a form's steps (useSteps), so it is reviewed first and sent only by Confirm; from a DeleteAction, which asks
// once; or as the `send` of a part that hands it to the steps itself. A write sent straight from a button would save
// in one press, as closing days once did.

import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SETTINGS = "apps/ops/src/settings";

/** The console's API modules: api.ts, and each feature's own (care-api.ts, settings-api.ts). */
const MODULES = [
  "apps/ops/src/api.ts",
  ...readdirSync("apps/ops/src", { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? readdirSync(`apps/ops/src/${entry.name}`)
          .filter((name) => name.endsWith("-api.ts"))
          .map((name) => `apps/ops/src/${entry.name}/${name}`)
      : [],
  ),
];

/** The calls that read, though they post: a search sends its words in the body. */
const READS_BY_POST = new Set(["findClients", "addressSuggestions"]);

/** Each module's members whose call writes, a post, put, patch or delete, by the module's exported name. */
function writesOf(): Map<string, Set<string>> {
  const writes = new Map<string, Set<string>>();
  for (const path of MODULES) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const { initializer } = declaration;
        if (!ts.isIdentifier(declaration.name) || initializer === undefined) continue;
        if (!ts.isObjectLiteralExpression(initializer)) continue;
        const members = new Set<string>();
        for (const member of initializer.properties) {
          if (!ts.isPropertyAssignment(member) || !ts.isIdentifier(member.name)) continue;
          const writing = /client\.(post|put|patch|delete)\(/.test(member.initializer.getText(source));
          if (writing && !READS_BY_POST.has(member.name.text)) members.add(member.name.text);
        }
        if (members.size > 0) writes.set(declaration.name.text, members);
      }
    }
  }
  return writes;
}

/** The parts whose `send` goes through the steps, each with the file and the words that show it does. */
const SENT_FOR_YOU: Readonly<Record<string, { readonly file: string; readonly proof: RegExp }>> = {
  DeleteAction: { file: "apps/ops/src/components/DeleteAction.tsx", proof: /const answer = await send\(\)/ },
  ActionCheck: { file: "apps/ops/src/settings/SettingForm.tsx", proof: /useSteps\(props\.send/ },
  ListEditor: { file: "apps/ops/src/settings/ListEditor.tsx", proof: /useSteps\(/ },
  Reasons: { file: "apps/ops/src/settings/JobSheet.tsx", proof: /<ListEditor \{\.\.\.list\}/ },
};

/** Whether a call sits in what useSteps sends, or in the send of a part that hands it on to them. */
function sentTheOneWay(node: ts.Node): boolean {
  for (let at = node.parent as ts.Node | undefined; at !== undefined; at = at.parent as ts.Node | undefined) {
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && at.expression.text === "useSteps") return true;
    if (ts.isJsxAttribute(at) && at.name.getText() === "send") {
      if (at.parent.parent.tagName.getText() in SENT_FOR_YOU) return true;
    }
  }
  return false;
}

/** Each write a settings file makes some other way, as "file: api.member" or "file: client.post". */
function strayWrites(file: string, writes: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const stray: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: object, name } = node.expression;
      const by = ts.isIdentifier(object) ? object.text : "";
      const writing =
        writes.get(by)?.has(name.text) === true || (by === "client" && /^(post|put|patch|delete)$/.test(name.text));
      if (writing && !sentTheOneWay(node)) stray.push(`${file}: ${by}.${name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return stray;
}

describe("Settings", () => {
  it.each(Object.entries(SENT_FOR_YOU))("%s hands its send on to the steps", (_part, { file, proof }) => {
    expect(readFileSync(file, "utf8")).toMatch(proof);
  });

  it("sends every write from a form’s steps or a DeleteAction", () => {
    const writes = writesOf();
    expect([...writes.values()].reduce((sum, members) => sum + members.size, 0)).toBeGreaterThan(20);
    expect(writes.get("settingsApi")?.size).toBeGreaterThan(3);
    const files = readdirSync(SETTINGS)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `${SETTINGS}/${name}`);
    expect(files.flatMap((file) => strayWrites(file, writes))).toEqual([]);
  });
});
