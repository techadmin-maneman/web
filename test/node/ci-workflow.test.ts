// What CI's own steps must keep to (.github/workflows/ci.yml). A step here that
// fails on a blip wastes a run; one that never fails checks nothing.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf8");

/** A step's lines, from its `- name:` to the next step's. */
function step(name: string): string {
  const lines = CI.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`ci.yml has no step "${name}"`);
  const indent = lines[start]?.indexOf("-") ?? 0;
  const next = lines.findIndex(
    (line, index) => index > start && line.indexOf("- ") === indent && line.trim().startsWith("- "),
  );
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
}

describe("the registry signatures step", () => {
  // npm now and then fails it with EMISSINGSIGNATUREKEY, a registry blip that a later try clears. On 28 September
  // 2026 a second try 15 seconds on failed three runs in a row.
  it("tries four times, half a minute apart, and fails the step if every try fails", () => {
    const text = step("Registry signatures");
    expect(text).toMatch(/for try in 1 2 3 4; do/);
    expect(text).toMatch(/if npm audit signatures; then exit 0; fi/);
    expect(text).toMatch(/sleep 30/);
    expect(text).toMatch(/done\n\s*exit 1\n/);
    expect(text).not.toContain("|| true");
    expect(text).not.toContain("continue-on-error");
  });

  // Still failing four tries in a row on 29 September 2026. A signature is verified when a lockfile brings the
  // package in, and the lockfile's integrity hash holds every later install to those bytes.
  it("runs when a pull request changes a package.json or the lockfile, and only then", () => {
    expect(step("Registry signatures")).toContain("if: needs.changes.outputs.dependencies == 'true'");
    const filter = step("Anything a build, a Worker or a browser can see, and any migration");
    expect(filter).toContain(`grep -qE '(^|/)package(-lock)?\\.json$' changed.txt`);
    expect(filter).toMatch(/echo "dependencies=true" >> "\$GITHUB_OUTPUT"/);
    expect(CI).toMatch(/dependencies: \$\{\{ steps\.filter\.outputs\.dependencies \}\}/);
  });
});

// The repository is public: a self-hosted runner would run a fork's pull request on the machine it lives on.
describe("where every workflow runs", () => {
  it("is GitHub's own runners, named in each job, with no variable that could move it", () => {
    for (const file of readdirSync(".github/workflows")) {
      const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
      const runners = [...workflow.matchAll(/^\s+runs-on:\s*(.+)$/gm)].map((match) => match[1]);
      expect(runners.length, file).toBeGreaterThan(0);
      expect(new Set(runners), file).toEqual(new Set(["ubuntu-latest"]));
    }
  });
});
