// The front-end files held past the size rules (eslint.front-pinned.ts) are each held at the size they have: a pin
// above a file's size, or on a file within the rules or gone, is a pin nobody lowered, and the list stops shrinking.

import { ESLint } from "eslint";
import { existsSync } from "node:fs";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { FRONT_PINNED } from "../../../eslint.front-pinned.ts";

/** eslint.config.ts's SIZE, the rules every other file keeps to. */
const SIZE = { fn: 80, lines: 400 };

const counted = { skipBlankLines: true, skipComments: true };

/** Each pinned file's longest function and its code lines, where either is past SIZE; null where it is within. */
async function sizesOf(files: readonly string[]) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: { parser: tseslint.parser },
        rules: {
          "max-lines-per-function": ["error", { max: SIZE.fn, ...counted }],
          "max-lines": ["error", { max: SIZE.lines, ...counted }],
        },
      },
    ],
  });
  const results = await eslint.lintFiles([...files]);
  const figure = (messages: readonly { message: string }[], rule: string) => {
    const sizes = messages
      .filter((message) => (message as { ruleId?: string | null }).ruleId === rule)
      .map((message) => Number(/\((\d+)\)/.exec(message.message)?.[1] ?? 0));
    return sizes.length === 0 ? null : Math.max(...sizes);
  };
  return new Map(
    results.map((result) => [
      result.filePath.replaceAll("\\", "/").split("/Web/").at(-1) ?? result.filePath,
      { fn: figure(result.messages, "max-lines-per-function"), lines: figure(result.messages, "max-lines") },
    ]),
  );
}

describe("the front-end files held past the size rules", () => {
  const files = Object.keys(FRONT_PINNED);

  it("are each still there", () => {
    expect(files.filter((file) => !existsSync(file))).toEqual([]);
  });

  it("are each held at the size they have, so a split lowers the pin and a file within the rules leaves the list", async () => {
    const sizes = await sizesOf(files.filter((file) => existsSync(file)));
    const off = files.flatMap((file) => {
      const pinned = FRONT_PINNED[file] ?? {};
      const size = [...sizes.entries()].find(([path]) => path.endsWith(file))?.[1];
      const fn = size?.fn ?? null;
      const lines = size?.lines ?? null;
      const wrong = (pinned.fn ?? null) !== fn || (pinned.lines ?? null) !== lines;
      return wrong ? [`${file}: pinned ${JSON.stringify(pinned)}, is ${JSON.stringify({ fn, lines })}`] : [];
    });
    expect(off).toEqual([]);
  }, 120_000);

  it("number fewer each week: 52 or fewer now", () => {
    expect(files.length).toBeLessThanOrEqual(52);
  });
});
