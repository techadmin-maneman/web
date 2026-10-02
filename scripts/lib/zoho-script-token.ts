// The refresh token a script mints its Zoho access tokens from: its own, never the Worker's.
//
// Zoho mints at most ten access tokens in ten minutes from one refresh token. A script run by hand that shared the
// Worker's took FSM down with it during the P2-M2 proof (docs/open-points.md, item 32), so the owner ruled on
// 27 September 2026 that scripts and proofs have a Self Client refresh token of their own. The Worker's may still be
// used, but only on purpose: `--use-worker-token`, for when the scripts' token is lost and a script must run now.

/** Where each Zoho client keeps the scripts' refresh token, and the Worker's beside it. */
export const SCRIPT_TOKENS = {
  crm: { scripts: "ZOHO_SCRIPTS_REFRESH_TOKEN", worker: "ZOHO_REFRESH_TOKEN" },
  fsm: { scripts: "ZOHO_FSM_SCRIPTS_REFRESH_TOKEN", worker: "ZOHO_FSM_REFRESH_TOKEN" },
} as const;

export type ZohoClient = keyof typeof SCRIPT_TOKENS;

export const USE_WORKER_TOKEN = "--use-worker-token";

/** The refresh token to use, or why there is none, in words for the person running the script. */
export function scriptRefreshToken(
  client: ZohoClient,
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): { readonly token: string; readonly warning: string | null } | { readonly problem: string } {
  const names = SCRIPT_TOKENS[client];
  const own = env[names.scripts]?.trim() ?? "";
  if (own !== "") return { token: own, warning: null };

  const workers = env[names.worker]?.trim() ?? "";
  if (argv.includes(USE_WORKER_TOKEN) && workers !== "") {
    return {
      token: workers,
      warning:
        `Using the Worker's ${names.worker}, as ${USE_WORKER_TOKEN} asks: every token minted here is one the Worker ` +
        "cannot mint for ten minutes.",
    };
  }
  return {
    problem:
      `${names.scripts} is not set. Scripts mint their Zoho tokens from a refresh token of their own, so they never ` +
      `spend the Worker's (docs/runbook.md, step 8.7, "A refresh token for scripts"). Add it to the --env-file, or pass ` +
      `${USE_WORKER_TOKEN} to use ${names.worker} on purpose.`,
  };
}

/** The refresh token, or the script stops with why. */
export function refreshTokenForScript(client: ZohoClient): string {
  const found = scriptRefreshToken(client, process.env, process.argv);
  if ("problem" in found) {
    console.error(found.problem);
    process.exit(2);
  }
  if (found.warning !== null) console.warn(found.warning);
  return found.token;
}
