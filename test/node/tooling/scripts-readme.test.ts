// scripts/ is grouped by who runs each script, and its README says what each does and whether it writes: no
// script lies loose at the top, and the README names every one.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Shared code and type declarations, which nobody runs. */
const NOT_RUN = ["lib", "types"];

const folders = readdirSync("scripts", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !NOT_RUN.includes(entry.name))
  .map((entry) => entry.name);

describe("scripts/", () => {
  it("keeps every script in a folder for who runs it", () => {
    const loose = readdirSync("scripts").filter((name) => name.endsWith(".ts"));
    expect(loose).toEqual([]);
    expect(folders.sort()).toEqual(["build", "ci", "dev", "fidelity", "ops", "release", "staging"]);
  });

  it("names every script in its README, under its folder", () => {
    const readme = readFileSync("scripts/README.md", "utf8");
    const named = (folder: string, name: string) => {
      const section = readme.split(`## ${folder}/`)[1]?.split("\n## ")[0] ?? "";
      const starred = [...section.matchAll(/`([a-z-]+)\*\.ts`/g)].map((match) => match[1] ?? "");
      return section.includes(`\`${name}\``) || starred.some((prefix) => name.startsWith(prefix));
    };
    const unnamed = folders.flatMap((folder) =>
      readdirSync(`scripts/${folder}`)
        .filter((name) => name.endsWith(".ts") && !named(folder, name))
        .map((name) => `${folder}/${name}`),
    );
    expect(unnamed).toEqual([]);
  });
});
