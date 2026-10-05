// Builds the site for every environment and hashes each file it would serve,
// so a change that must not alter the site, such as moving the brand files
// into packages/brand, can be shown to leave every build byte-identical.
//
//   node scripts/build/dist-hash.ts --out before.json       build, and record the hashes
//   node scripts/build/dist-hash.ts --compare before.json   build, and list every file that differs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const ENVIRONMENTS = ["local", "staging", "production"] as const;

type Hashes = Record<string, Record<string, string>>;

const { values } = parseArgs({ options: { out: { type: "string" }, compare: { type: "string" } } });

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function hashBuild(environment: string): Record<string, string> {
  execFileSync(process.execPath, ["scripts/build/build-site.ts", "--env", environment], { stdio: "inherit" });
  const root = join("site", "dist", environment);
  const hashes: Record<string, string> = {};
  for (const file of filesUnder(root).sort()) {
    hashes[relative(root, file).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  return hashes;
}

function differences(before: Hashes, after: Hashes): string[] {
  const lines: string[] = [];
  for (const environment of ENVIRONMENTS) {
    const was = before[environment] ?? {};
    const now = after[environment] ?? {};
    for (const file of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[file] === undefined) lines.push(`${environment}: added ${file}`);
      else if (now[file] === undefined) lines.push(`${environment}: removed ${file}`);
      else if (was[file] !== now[file]) lines.push(`${environment}: changed ${file}`);
    }
  }
  return lines;
}

const hashes: Hashes = Object.fromEntries(ENVIRONMENTS.map((environment) => [environment, hashBuild(environment)]));
const fileCount = Object.values(hashes).reduce((total, files) => total + Object.keys(files).length, 0);

if (values.out !== undefined) {
  writeFileSync(values.out, `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(`recorded ${String(fileCount)} files across ${String(ENVIRONMENTS.length)} builds in ${values.out}`);
}

if (values.compare !== undefined) {
  const found = differences(JSON.parse(readFileSync(values.compare, "utf8")) as Hashes, hashes);
  for (const line of found) console.error(line);
  if (found.length > 0) process.exit(1);
  console.log(`identical: ${String(fileCount)} files across ${String(ENVIRONMENTS.length)} builds`);
}
