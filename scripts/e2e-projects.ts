// Prints the browser-test projects a pull request's changed files reach, and whether Lighthouse runs
// (scripts/lib/e2e-projects.ts): projects=--project=390 --project=1440, all=false, lighthouse=true.
//
//   git diff --name-only origin/main...HEAD | node scripts/e2e-projects.ts >> "$GITHUB_OUTPUT"
//   node scripts/e2e-projects.ts --all >> "$GITHUB_OUTPUT"      a staging deploy: every project

import { readFileSync } from "node:fs";
import { ALL_PROJECTS, needsLighthouse, touchedProjects } from "./lib/e2e-projects.ts";

const everything = process.argv.includes("--all");
const projects = everything ? [...ALL_PROJECTS] : touchedProjects(readFileSync(0, "utf8").split("\n"));

console.error(`browser tests: ${projects.length === 0 ? "none" : projects.join(", ")}`);
console.log(`projects=${projects.map((project) => `--project=${project}`).join(" ")}`);
console.log(`all=${String(projects.length === ALL_PROJECTS.length)}`);
console.log(`lighthouse=${String(needsLighthouse(projects))}`);
