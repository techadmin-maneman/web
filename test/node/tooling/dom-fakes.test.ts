// The component tests fake the API only through contractChecked (test/dom/contract-fetch.ts), so a reply the API could
// never give fails the test rather than passing it, and wait for an answer with answered() (test/dom/render-hook.ts)
// rather than a bare timer outside React's act.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = readdirSync("test/dom")
  .filter((name) => name.endsWith(".ts") && name !== "render-hook.ts" && name !== "contract-fetch.ts")
  .map((name) => ({ name, text: readFileSync(`test/dom/${name}`, "utf8") }));

describe("the component tests", () => {
  it("fake fetch only through the contract's check", () => {
    const bare = FILES.filter(({ text }) =>
      [...text.matchAll(/vi\.stubGlobal\(\s*"fetch",\s*/g)].some(
        (match) => !text.slice(match.index + match[0].length).startsWith("contractChecked("),
      ),
    );
    expect(bare.map(({ name }) => name)).toEqual([]);
  });

  it("wait for an answer with answered(), never a bare timer", () => {
    const timed = FILES.filter(({ text }) => text.includes("new Promise((resolve) => setTimeout(resolve, 0))"));
    expect(timed.map(({ name }) => name)).toEqual([]);
  });
});
