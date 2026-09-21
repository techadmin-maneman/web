import { describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import {
  PLACEHOLDER_DATABASE_ID,
  checkAccountsAgree,
  checkApiConfig,
  checkSiteConfig,
} from "../../scripts/lib/wrangler-config-check.ts";
import { DELETE, edited, type Edit } from "./json-edit.ts";

const realApi = readJsonc("wrangler.jsonc");
const realSite = readJsonc("site/wrangler.jsonc");
const api = (...edits: Edit[]) => checkApiConfig(edited(realApi, ...edits)).join("\n");
const site = (...edits: Edit[]) => checkSiteConfig(edited(realSite, ...edits)).join("\n");

describe("mm-api wrangler config", () => {
  it("the committed config passes", () => {
    expect(checkApiConfig(realApi)).toEqual([]);
  });

  it("the committed deliberately broken fixture fails", () => {
    const fixture = readJsonc("test/fixtures/wrangler/broken-staging-inherits-bindings.jsonc");
    expect(checkApiConfig(fixture)).toEqual([
      "env.staging: queues.producers is not redeclared (the top level declares RENDER_QUEUE, CRM_QUEUE, MESSAGE_QUEUE)",
    ]);
  });

  it.each<[string, Edit, string]>([
    ["staging drops its database", ["env.staging.d1_databases", DELETE], "env.staging: d1_databases is not redeclared"],
    [
      "staging drops its buckets",
      ["env.staging.r2_buckets", DELETE],
      "env.staging: r2_buckets is not redeclared (the top level declares UPLOADS, RESULTS)",
    ],
    ["production drops its vars", ["env.production.vars", DELETE], "env.production: vars is not redeclared"],
    [
      "production drops version metadata",
      ["env.production.version_metadata", DELETE],
      "version_metadata is not redeclared",
    ],
    ["staging drops one var", ["env.staging.vars.MESSAGING_PROVIDER", DELETE], "env.staging: vars declares"],
    ["staging drops one queue", ["env.staging.queues.producers.2", DELETE], "env.staging: queues.producers declares"],
    [
      "staging adds a binding local lacks",
      ["env.staging.kv_namespaces", [{ binding: "KV", id: "x" }]],
      "env.staging: declares kv_namespaces, which the top level (local) does not",
    ],
    [
      "the top level adds a binding staging lacks",
      ["kv_namespaces", [{ binding: "KV", id: "x" }]],
      "env.staging: kv_namespaces is not redeclared",
    ],
    [
      "production drops its queue consumer",
      ["env.production.queues.consumers", DELETE],
      "env.production: queues.consumers is not redeclared",
    ],
    [
      "staging consumes a different queue",
      ["env.staging.queues.consumers.0.queue", "mm-other-staging"],
      "env.staging: queues.consumers declares [mm-other-staging, mm-render-staging, mm-messaging-staging]",
    ],
  ])("fails when %s", (_label, edit, problem) => {
    expect(api(edit)).toContain(problem);
  });

  it("fails when staging names a production queue, and when two environments share it", () => {
    const problems = checkApiConfig(edited(realApi, ["env.staging.queues.producers.0.queue", "mm-render-prod"]));
    expect(problems).toEqual(
      expect.arrayContaining([
        'env.staging: queue "mm-render-prod" is not named for staging (expected "staging")',
        'env.staging: queue "mm-render-prod" is named for another environment ("prod")',
        'env.production and env.staging share the resource "mm-render-prod"',
      ]),
    );
  });

  it("fails when staging names a production bucket", () => {
    const problems = api(["env.staging.r2_buckets.0.bucket_name", "mm-prod-tryon-uploads"]);
    expect(problems).toContain(
      'env.staging: R2 bucket "mm-prod-tryon-uploads" is named for another environment ("prod")',
    );
    expect(problems).toContain('env.production and env.staging share the resource "mm-prod-tryon-uploads"');
  });

  it("fails when staging is bound to the production database", () => {
    const problems = api(["env.staging.d1_databases.0.database_name", "maneman-prod"]);
    expect(problems).toContain('env.staging: D1 database "maneman-prod" must be "maneman-staging"');
    expect(problems).toContain('share the resource "maneman-prod"');
  });

  it("fails when two environments share a real database ID", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(
      api(["env.staging.d1_databases.0.database_id", id], ["env.production.d1_databases.0.database_id", id]),
    ).toContain(`env.production and env.staging share the resource "${id}"`);
  });

  it("fails when ENVIRONMENT disagrees with the environment block", () => {
    expect(api(["env.production.vars.ENVIRONMENT", "staging"])).toContain(
      'env.production: vars.ENVIRONMENT is "staging", expected "production"',
    );
  });

  it("fails when routes sit at the top level, where every environment would inherit them", () => {
    const problems = api(
      ["routes", [{ pattern: "maneman.in/api/*", zone_name: "maneman.in" }]],
      ["env.staging.routes", DELETE],
    );
    expect(problems).toContain(
      "top level: routes must not be declared at the top level (wrangler inherits them into every environment)",
    );
    expect(problems).toContain("env.staging: routes must be set explicitly (wrangler inherits it)");
  });

  it("fails when a route points at the other environment's host", () => {
    expect(api(["env.staging.routes.0.pattern", "maneman.in/api/*"])).toContain(
      'env.staging: routes must be exactly [{ pattern: "staging.maneman.in/api/*", zone_name: "maneman.in" }]',
    );
  });

  it.each<[string, Edit, string]>([
    ["workers_dev is enabled", ["env.staging.workers_dev", true], "workers_dev must be false"],
    [
      "workers_dev is inherited",
      ["env.staging.workers_dev", DELETE],
      "env.staging: workers_dev must be set explicitly",
    ],
    ["preview URLs are enabled", ["env.production.preview_urls", true], "preview_urls must be false"],
    [
      "observability is off",
      ["env.production.observability", { enabled: false }],
      "observability.enabled must be true",
    ],
    [
      "the account is inherited",
      ["env.production.account_id", DELETE],
      "env.production: account_id must be set explicitly",
    ],
    ["the Worker name is wrong", ["env.staging.name", "mm-api-production"], 'expected "mm-api-staging"'],
    [
      "staging inherits the cron",
      ["env.staging.triggers", DELETE],
      "env.staging: triggers is inherited from the top level",
    ],
    ["an environment is missing", ["env.production", DELETE], "env.production is missing"],
    [
      "local names a staging resource",
      ["queues.producers.0.queue", "mm-render-staging"],
      'top level (local): queue "mm-render-staging"',
    ],
    [
      "a required binding is missing everywhere",
      ["version_metadata", DELETE],
      "top level (local): missing required binding CF_VERSION_METADATA",
    ],
  ])("fails when %s", (_label, edit, problem) => {
    expect(api(edit)).toContain(problem);
  });

  it.each<[string, Edit, string]>([
    ["local adds Workers AI", ["ai", { binding: "AI" }], "top level (local): ai is not on the free-tier allowlist"],
    [
      "production adds Browser Rendering",
      ["env.production.browser", { binding: "BROWSER" }],
      "env.production: browser is not on the free-tier allowlist",
    ],
    [
      "staging adds a KV namespace",
      ["env.staging.kv_namespaces", [{ binding: "KV", id: "x" }]],
      "env.staging: kv_namespaces is not on the free-tier allowlist",
    ],
    ["production sets a CPU limit", ["env.production.limits", { cpu_ms: 50 }], "env.production: limits is not allowed"],
  ])("fails when %s, which can bill or needs a paid plan", (_label, edit, problem) => {
    expect(api(edit)).toContain(problem);
  });

  it("at deploy time, requires real database IDs", () => {
    expect(checkApiConfig(realApi, { requireProvisioned: true })).toEqual([]);

    const unprovisioned = edited(realApi, ["env.staging.d1_databases.0.database_id", PLACEHOLDER_DATABASE_ID]);
    expect(checkApiConfig(unprovisioned)).toEqual([]);
    expect(checkApiConfig(unprovisioned, { requireProvisioned: true })).toEqual([
      "env.staging: D1 database_id is a placeholder; provision it first",
    ]);
  });
});

describe("mm-site wrangler config", () => {
  it("the committed config passes", () => {
    expect(checkSiteConfig(realSite)).toEqual([]);
    expect(checkAccountsAgree(realApi, realSite)).toEqual([]);
  });

  it.each<[string, Edit, string]>([
    [
      "it declares a binding",
      ["env.production.vars", { X: "1" }],
      "site env.production: mm-site must not declare vars",
    ],
    ["it declares code", ["main", "src/index.ts"], "mm-site is assets-only"],
    [
      "its route is the API's",
      ["env.staging.routes.0.pattern", "staging.maneman.in/api/*"],
      "site env.staging: routes must be exactly",
    ],
    [
      "it uses a custom domain",
      ["env.production.routes.0.custom_domain", true],
      "site env.production: routes must be exactly",
    ],
    ["assets are inherited", ["env.staging.assets", DELETE], "site env.staging: assets must be declared explicitly"],
    ["an environment is missing", ["env.staging", DELETE], "site env.staging is missing"],
    [
      "routes sit at the top level",
      ["routes", [{ pattern: "maneman.in/*", zone_name: "maneman.in" }]],
      "site top level: routes must not be declared",
    ],
  ])("fails when %s", (_label, edit, problem) => {
    expect(site(edit)).toContain(problem);
  });

  it("fails when the two Workers of an environment deploy to different accounts", () => {
    expect(
      checkAccountsAgree(realApi, edited(realSite, ["env.staging.account_id", "another-account"])).join("\n"),
    ).toContain("env.staging: mm-api and mm-site deploy to different accounts");
  });
});
