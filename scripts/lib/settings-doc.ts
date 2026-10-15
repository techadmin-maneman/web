// docs/settings.md: every setting the system runs on and where it lives, in one table each, read from where they
// are kept so it cannot drift: the Worker's vars in wrangler.jsonc, its secrets' names, the fixed limits, the
// per-environment constants in code, the rules ops set in the console, and the dated tables. Answers "what decides X
// in production?" from one page.
//
//   npm run settings

import { readFileSync } from "node:fs";
import { FIXED_LIMITS } from "../../src/config/limits.ts";
import * as environments from "../../src/config/environments.ts";
import { isChoice, OPS_SETTINGS } from "../../src/policy/ops-settings.ts";
import { readJsonc } from "./jsonc.ts";

type Vars = Readonly<Record<string, string>>;

/** The dated tables that hold business figures, each read as of a day, and where ops change it. */
const DATED_TABLES: readonly (readonly [table: string, holds: string, where: string])[] = [
  ["price_book", "Each product's price, from a day on", "Prices"],
  ["city_prices", "A city's own price for a product, from a day on", "Cities"],
  ["services", "The services sold, and the Books item each is invoiced on", "Prices"],
  ["serviceable_pincodes", "The pincodes served, and each one's city", "Areas"],
  ["slot_times", "The booking windows' times, from a day on", "none yet: a migration"],
  ["visit_blackouts", "The days closed everywhere", "Settings · Blackouts"],
  ["city_blackouts", "The days one city alone is closed, for a local holiday", "Settings · Blackouts"],
  ["checklist_items", "The job sheet's checklist, in the technician's and the client's words", "Settings · Job sheet"],
  ["partial_reasons", "Why a visit is left partly done", "Settings · Job sheet"],
  ["lost_reasons", "Why a lead is lost", "Settings · Job sheet"],
  ["word_versions", "The words the site and the apps show, as ops edit them", "Words"],
];

const cell = (value: string): string => (value === "" ? "—" : `\`${value.replaceAll("|", "\\|")}\``);

const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

function varsTable(local: Vars, staging: Vars, production: Vars): string[] {
  const names = [...new Set([...Object.keys(local), ...Object.keys(staging), ...Object.keys(production)])].sort();
  return [
    "| Var | Local | Staging | Production |",
    "| --- | --- | --- | --- |",
    ...names.map(
      (name) =>
        `| \`${name}\` | ${cell(local[name] ?? "")} | ${cell(staging[name] ?? "")} | ${cell(production[name] ?? "")} |`,
    ),
  ];
}

/** Every name the Worker's environment carries, as `wrangler types` writes them, less the vars: its secrets. */
function secretNames(vars: ReadonlySet<string>): string[] {
  const types = readFileSync("src/worker-configuration.d.ts", "utf8");
  const picked = /interface ProcessEnv extends StringifyValues<Pick<Cloudflare\.Env, ([^>]+)>>/.exec(types)?.[1] ?? "";
  return [...picked.matchAll(/"([A-Z0-9_]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => !vars.has(name))
    .sort();
}

const CONSTANT_ROWS = Object.entries(environments)
  .filter(([name, value]) => /^[A-Z_]+$/.test(name) && typeof value !== "function" && name !== "PROVIDER_VARS")
  .sort(([a], [b]) => a.localeCompare(b));

function opsRows(): string[] {
  return OPS_SETTINGS.map((setting) => {
    const unit = isChoice(setting) ? "a choice" : setting.unit;
    return `| \`${setting.name}\` | ${setting.title} | ${unit} | \`${show(setting.fallback)}\` |`;
  });
}

export function settingsDoc(): string {
  const config = readJsonc("wrangler.jsonc") as { vars: Vars; env: Record<string, { vars: Vars }> };
  const staging = config.env.staging?.vars ?? {};
  const production = config.env.production?.vars ?? {};
  const varNames = new Set([...Object.keys(config.vars), ...Object.keys(staging), ...Object.keys(production)]);
  return [
    "# Settings, and where each lives",
    "",
    "Written by `npm run settings` (scripts/lib/settings-doc.ts) from where each is kept; a test fails while it is out of date. To change one, change it where the table says.",
    "",
    "## Worker vars",
    "",
    "In `wrangler.jsonc`, read at startup and checked by the startup guard (`src/config/settings.ts`). Only what differs by environment, or is a vendor's ID, belongs here.",
    "",
    ...varsTable(config.vars, staging, production),
    "",
    "## Secrets",
    "",
    "Set with `wrangler secret put` in each environment (docs/provisioning.md); never in the repository. Locally in `.dev.vars`.",
    "",
    ...secretNames(varNames).map((name) => `- \`${name}\``),
    "",
    "## Fixed limits",
    "",
    "In `src/config/limits.ts`: the same everywhere. Only a local run may raise one, with a var of the same name.",
    "",
    "| Limit | Figure |",
    "| --- | --- |",
    ...Object.entries(FIXED_LIMITS).map(([name, figure]) => `| \`${name}\` | ${String(figure)} |`),
    "",
    "## Per-environment constants",
    "",
    "In `src/config/environments.ts`: hosts, origins and resource names, which change only with the infrastructure.",
    "",
    "| Constant | Value |",
    "| --- | --- |",
    ...CONSTANT_ROWS.map(([name, value]) => `| \`${name}\` | \`${show(value).replaceAll("|", "\\|")}\` |`),
    "",
    "## Rules ops set",
    "",
    "In the console, Settings · Rules: kept in D1 (`ops_settings`), in force from the next request. The committed figure stands until ops set one (`src/policy/ops-settings.ts`); `daily_ceilings` shows each environment's own figures until then.",
    "",
    "| Rule | Title | Unit | Committed figure |",
    "| --- | --- | --- | --- |",
    ...opsRows(),
    "",
    "## Dated tables",
    "",
    "In D1, each row from a day on, so a document already issued keeps what was true then (docs/decisions/0061-ops-editable-inputs.md).",
    "",
    "| Table | Holds | Changed in the console under |",
    "| --- | --- | --- |",
    ...DATED_TABLES.map(([table, holds, where]) => `| \`${table}\` | ${holds} | ${where} |`),
    "",
  ].join("\n");
}

/** The tables the page names, so a test can hold each to the schema. */
export const DATED_TABLE_NAMES: readonly string[] = DATED_TABLES.map(([table]) => table);
