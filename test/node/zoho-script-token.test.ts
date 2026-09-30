import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptRefreshToken, USE_WORKER_TOKEN } from "../../scripts/lib/zoho-script-token.ts";

describe("a script's Zoho refresh token", () => {
  it("is the scripts' own, for each client", () => {
    const env = { ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts", ZOHO_FSM_SCRIPTS_REFRESH_TOKEN: "fsm-scripts" };
    expect(scriptRefreshToken("crm", env, [])).toEqual({ token: "crm-scripts", warning: null });
    expect(scriptRefreshToken("fsm", env, [])).toEqual({ token: "fsm-scripts", warning: null });
  });

  it("is never the Worker's unless the person running the script asks for it", () => {
    const env = { ZOHO_REFRESH_TOKEN: "crm-worker", ZOHO_FSM_REFRESH_TOKEN: "fsm-worker" };
    const refused = scriptRefreshToken("crm", env, []);
    expect(refused).toEqual({ problem: expect.stringContaining("ZOHO_SCRIPTS_REFRESH_TOKEN is not set") });

    const asked = scriptRefreshToken("fsm", env, [USE_WORKER_TOKEN]);
    expect(asked).toEqual({ token: "fsm-worker", warning: expect.stringContaining("ZOHO_FSM_REFRESH_TOKEN") });
  });

  it("prefers the scripts' own even when the Worker's is asked for", () => {
    const env = { ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts", ZOHO_REFRESH_TOKEN: "crm-worker" };
    expect(scriptRefreshToken("crm", env, [USE_WORKER_TOKEN])).toEqual({ token: "crm-scripts", warning: null });
  });

  it("refuses a blank one, and the Worker's flag with no Worker's token", () => {
    expect(scriptRefreshToken("crm", { ZOHO_SCRIPTS_REFRESH_TOKEN: "  " }, [])).toHaveProperty("problem");
    expect(scriptRefreshToken("fsm", {}, [USE_WORKER_TOKEN])).toHaveProperty("problem");
  });

  it("is what every script that talks to Zoho reads", () => {
    for (const script of ["scripts/check-zoho-setup.ts", "scripts/setup-crm.ts", "scripts/setup-fsm.ts"]) {
      const source = readFileSync(script, "utf8");
      expect(source, script).toContain("refreshTokenForScript(");
      expect(source, script).not.toMatch(/required\("ZOHO_(FSM_)?REFRESH_TOKEN"\)/);
    }
  });
});
