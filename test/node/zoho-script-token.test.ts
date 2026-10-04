import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptRefreshToken, USE_WORKER_TOKEN } from "../../scripts/lib/zoho-script-token.ts";

describe("a script's Zoho refresh token", () => {
  it("is the scripts' own, for each client", () => {
    const env = { ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts", ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN: "books-scripts" };
    expect(scriptRefreshToken("crm", env, [])).toEqual({ token: "crm-scripts", warning: null });
    expect(scriptRefreshToken("books", env, [])).toEqual({ token: "books-scripts", warning: null });
  });

  it("is never the CRM's for Books", () => {
    const env = { ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts", ZOHO_REFRESH_TOKEN: "crm-worker" };
    const refused = scriptRefreshToken("books", env, [USE_WORKER_TOKEN]);
    expect("problem" in refused ? refused.problem : "").toContain("ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN is not set");
  });

  it("is never the Worker's unless the person running the script asks for it", () => {
    const env = { ZOHO_REFRESH_TOKEN: "crm-worker", ZOHO_BOOKS_REFRESH_TOKEN: "books-worker" };
    const refused = scriptRefreshToken("crm", env, []);
    expect("problem" in refused ? refused.problem : "").toContain("ZOHO_SCRIPTS_REFRESH_TOKEN is not set");

    const asked = scriptRefreshToken("books", env, [USE_WORKER_TOKEN]);
    expect(asked).toMatchObject({ token: "books-worker" });
    expect("warning" in asked ? asked.warning : "").toContain("ZOHO_BOOKS_REFRESH_TOKEN");
  });

  it("prefers the scripts' own even when the Worker's is asked for", () => {
    const env = { ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts", ZOHO_REFRESH_TOKEN: "crm-worker" };
    expect(scriptRefreshToken("crm", env, [USE_WORKER_TOKEN])).toEqual({ token: "crm-scripts", warning: null });
  });

  it("refuses a blank one, and the Worker's flag with no Worker's token", () => {
    expect(scriptRefreshToken("crm", { ZOHO_SCRIPTS_REFRESH_TOKEN: "  " }, [])).toHaveProperty("problem");
    expect(scriptRefreshToken("books", {}, [USE_WORKER_TOKEN])).toHaveProperty("problem");
  });

  it("is what every script that talks to Zoho reads", () => {
    const scripts = ["scripts/check-zoho-setup.ts", "scripts/setup-crm.ts", "scripts/check-books-setup.ts"];
    for (const script of scripts) {
      const source = readFileSync(script, "utf8");
      expect(source, script).toContain("refreshTokenForScript(");
      expect(source, script).not.toMatch(/required\("ZOHO_(BOOKS_)?REFRESH_TOKEN"\)/);
    }
  });

  // Each parses its flags strictly, so one it does not name stops it before the token is read.
  it("is asked for with a flag the setup scripts take", () => {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.startsWith("ZOHO_")) env[name] = undefined;
    const runs = [
      ["scripts/setup-crm.ts", "--check"],
      ["scripts/check-books-setup.ts", "--env", "staging"],
    ] as const;
    for (const [script, ...flags] of runs) {
      const run = spawnSync(process.execPath, [script, ...flags, USE_WORKER_TOKEN], { env, encoding: "utf8" });
      expect(run.stderr, script).not.toContain("ERR_PARSE_ARGS");
      expect(run.stderr, script).toContain("is not set; pass the secrets file with --env-file");
    }
  });
});
