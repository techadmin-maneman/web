// Where gold may stand in the technician app and the ops console. The prompts'
// rule, which the owner chose over the boards on 27 September 2026 (ADR 0025,
// item 59): "gold on the one primary action only" in the technician app, and
// in the console "Gold marks the selection and the one primary action, nothing
// else". The mark is the brand's, drawn gilt on ink, and not an action.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** Every rule that draws in gold, as "file selector". */
function gilded(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body = ""]) => body.includes("var(--gilt)"))
      .map(([, selector = ""]) => `${file} ${selector.split(";").at(-1)?.trim() ?? ""}`);
  });
}

describe("gold", () => {
  it("marks only the technician app's one primary action, beside the mark", () => {
    expect(gilded([...stylesheets("apps/tech/src"), "packages/ui/button.module.css"])).toEqual([
      "apps/tech/src/login/login.module.css .mark",
      "apps/tech/src/today/today.module.css .mark",
      "packages/ui/button.module.css .gold",
    ]);
  });

  it("marks only the console's selection, beside the mark; its one primary action is on ink", () => {
    expect(gilded(stylesheets("apps/ops/src"))).toEqual([
      "apps/ops/src/components/shell.module.css .mark",
      'apps/ops/src/components/shell.module.css .section[aria-current="page"]',
    ]);
  });
});
