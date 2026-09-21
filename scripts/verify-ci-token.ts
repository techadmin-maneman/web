// Checks that an environment's CI secrets have exactly the access docs/runbook.md
// asks for. Everything is read-only apart from one no-op write (re-inserting the
// database identity row, which already exists), so it is safe on production.
//
//   node --env-file=.env.ci-staging scripts/verify-ci-token.ts staging
//   node --env-file=.env.ci-production scripts/verify-ci-token.ts production
//
// The env file holds CLOUDFLARE_API_TOKEN and, for staging, CF_ACCESS_CLIENT_ID
// and CF_ACCESS_CLIENT_SECRET. No value is ever printed.

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { EXPECTED_DATABASE_NAME, HOSTNAME, ZONE_ID, type RemoteEnvironmentName } from "../src/config/environments.ts";
import { readJsonc } from "./lib/jsonc.ts";

const environment = process.argv[2];
if (environment !== "staging" && environment !== "production") {
  console.error("usage: node --env-file=<file> scripts/verify-ci-token.ts <staging|production>");
  process.exit(2);
}
const otherEnvironment: RemoteEnvironmentName = environment === "staging" ? "production" : "staging";

const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if (token === "") {
  console.error("CLOUDFLARE_API_TOKEN is not set; pass the env file with --env-file");
  process.exit(2);
}

/** The parts of wrangler.jsonc this script needs. */
const WranglerConfig = z.object({
  env: z.record(
    z.string(),
    z.object({ account_id: z.string(), d1_databases: z.array(z.object({ database_id: z.string() })) }),
  ),
});
const config = WranglerConfig.parse(readJsonc("wrangler.jsonc"));

function environmentConfig(name: RemoteEnvironmentName): { accountId: string; databaseId: string } {
  const block = config.env[name];
  const databaseId = block?.d1_databases[0]?.database_id;
  if (block === undefined || databaseId === undefined) throw new Error(`wrangler.jsonc has no ${name} database`);
  return { accountId: block.account_id, databaseId };
}

const own = environmentConfig(environment);
const other = environmentConfig(otherEnvironment);

// ---------------------------------------------------------------------------

interface ApiResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

/** Calls the Cloudflare API with the token under test. */
async function cloudflare(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body: unknown = await response.json().catch(() => null);
  const success = typeof body === "object" && body !== null && "success" in body && body.success === true;
  return { ok: response.ok && success, status: response.status, body };
}

function runSql(databaseId: string, sql: string): Promise<ApiResult> {
  return cloudflare(`/accounts/${own.accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
}

function readDeployments(worker: string): Promise<ApiResult> {
  return cloudflare(`/accounts/${own.accountId}/workers/scripts/${worker}/deployments`);
}

type Outcome = "PASS" | "FAIL" | "NOTE";
const outcomes: Outcome[] = [];

function report(outcome: Outcome, check: string, detail: string): void {
  outcomes.push(outcome);
  console.log(`${outcome}  ${check}: ${detail}`);
}

function expectAllowed(check: string, result: ApiResult): void {
  report(result.ok ? "PASS" : "FAIL", check, result.ok ? "allowed" : `denied (HTTP ${String(result.status)})`);
}

function expectDenied(check: string, result: ApiResult, why: string): void {
  report(result.ok ? "FAIL" : "PASS", check, result.ok ? `allowed, but ${why}` : "denied, as intended");
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

console.log(`Checking the ${environment} CI secrets\n`);

const accountToken = await cloudflare(`/accounts/${own.accountId}/tokens/verify`);
if (accountToken.ok) {
  report("PASS", "token", "active, owned by the Maneman account");
} else {
  const userToken = await cloudflare("/user/tokens/verify");
  report(
    userToken.ok ? "NOTE" : "FAIL",
    "token",
    userToken.ok ? "active, but owned by a user; the runbook asks for an account-owned token" : "not valid",
  );
}

expectAllowed(`reads mm-api-${environment}`, await readDeployments(`mm-api-${environment}`));
expectAllowed(`reads mm-site-${environment}`, await readDeployments(`mm-site-${environment}`));
expectDenied(
  `reads mm-api-${otherEnvironment}`,
  await readDeployments(`mm-api-${otherEnvironment}`),
  "the token should only reach its own environment's Workers",
);
expectDenied(
  `reads mm-site-${otherEnvironment}`,
  await readDeployments(`mm-site-${otherEnvironment}`),
  "the token should only reach its own environment's Workers",
);

// The row already exists and cannot change, so this insert does nothing; it only proves the token may write.
const expectedName = EXPECTED_DATABASE_NAME[environment];
expectAllowed(
  `writes to ${expectedName}`,
  await runSql(
    own.databaseId,
    `INSERT INTO deployment_identity (id, database_name) VALUES (1, '${expectedName}') ON CONFLICT(id) DO NOTHING`,
  ),
);

const otherDatabase = await runSql(other.databaseId, "SELECT 1");
report(
  "NOTE",
  `reads ${EXPECTED_DATABASE_NAME[otherEnvironment]}`,
  otherDatabase.ok
    ? "allowed: D1 permissions are account-wide (accepted in docs/decisions/0008)"
    : "denied (tighter than required)",
);

expectDenied(
  "manages zone routes",
  await cloudflare(`/zones/${ZONE_ID}/workers/routes`),
  "CI must not change routes (docs/decisions/0004)",
);
expectDenied("manages R2 buckets", await cloudflare(`/accounts/${own.accountId}/r2/buckets`), "CI does not need R2");
expectDenied("manages queues", await cloudflare(`/accounts/${own.accountId}/queues`), "CI does not need Queues");

// The exact wrangler call the deploy workflows start with.
try {
  const version = execFileSync(
    process.execPath,
    ["scripts/release.ts", "current", "--worker", "mm-api", "--env", environment],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  report("PASS", "wrangler", `sees mm-api-${environment} serving ${version}`);
} catch (error) {
  const reason = error instanceof Error && "stderr" in error ? String(error.stderr).split("\n")[0] : String(error);
  report("FAIL", "wrangler", `cannot read the deployment: ${reason ?? ""}`);
}

// Access: staging needs the service token; production must stay public.

/** Who answered: the Worker, the Access login, or a Cloudflare challenge in front of both. */
function describe(response: Response): string {
  const status = `HTTP ${String(response.status)}`;
  if (response.headers.get("cf-mitigated") === "challenge") {
    const ray = response.headers.get("cf-ray") ?? "unknown";
    return `${status}, a Cloudflare challenge answered before Access or the Worker (Ray ID ${ray})`;
  }
  if ((response.headers.get("location") ?? "").includes("cloudflareaccess.com")) {
    return `${status}, redirected to the Access login`;
  }
  return status;
}

const healthUrl = `https://${HOSTNAME[environment]}/api/health`;
if (environment === "staging") {
  const accessId = process.env.CF_ACCESS_CLIENT_ID ?? "";
  const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
  if (accessId === "" || accessSecret === "") {
    report("FAIL", "Access service token", "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are not both set");
  } else if (!accessId.endsWith(".access")) {
    // Access ignores a malformed token and redirects to the login, which looks like a policy problem.
    report("FAIL", "Access service token", "CF_ACCESS_CLIENT_ID should end in .access; it looks cut short");
  } else {
    const withToken = await fetch(healthUrl, {
      headers: { "CF-Access-Client-Id": accessId, "CF-Access-Client-Secret": accessSecret },
      redirect: "manual",
    });
    report(withToken.status === 200 ? "PASS" : "FAIL", "Access service token", describe(withToken));
  }

  const withoutToken = await fetch(healthUrl, { redirect: "manual" });
  const sentToLogin = (withoutToken.headers.get("location") ?? "").includes("cloudflareaccess.com");
  report(sentToLogin ? "PASS" : "FAIL", "Access without a token", describe(withoutToken));
} else {
  const response = await fetch(healthUrl, { redirect: "manual" });
  report(response.status === 200 ? "PASS" : "FAIL", "public health check", describe(response));
}

const failed = outcomes.filter((outcome) => outcome === "FAIL").length;
console.log(
  failed === 0 ? `\n${environment}: all checks passed` : `\n${environment}: ${String(failed)} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
