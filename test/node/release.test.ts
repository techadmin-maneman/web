// What the deploy workflows ask of scripts/release.ts, against a fake wrangler
// that answers as Cloudflare does. The workflows' shell only ever calls these,
// so a failure here is a deploy that would have gone wrong.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentVersion, restore, ship, type Environment, type Wrangler } from "../../scripts/lib/release.ts";
import { workerNamed, type WorkerName } from "../../scripts/lib/workers.ts";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";

/** A wrangler failure as execFileSync throws it: the message, and wrangler's own words on stderr. */
function wranglerError(stderr: string): Error {
  return Object.assign(new Error("Command failed: wrangler"), { stderr });
}

const NOT_FOUND = wranglerError("✘ [ERROR] This Worker does not exist on your account. [code: 10007]");
const UNAUTHORISED = wranglerError("✘ [ERROR] Authentication error [code: 10000]");
const LOST = wranglerError("✘ [ERROR] fetch failed: terminated");

type Status = { split: { version_id: string; percentage: number }[] } | { error: Error };

/** A Worker on a fake account: `deployments status` answers each of `statuses` in turn, then the last again. */
function fakeWorker(...statuses: Status[]): { wrangler: Wrangler; calls: string[] } {
  const calls: string[] = [];
  const wrangler: Wrangler = (args, extraEnv = {}) => {
    const command = args.join(" ");
    calls.push(command);
    if (command.startsWith("deployments status")) {
      const status = statuses.length > 1 ? statuses.shift() : statuses[0];
      if (status === undefined) throw new Error("no status to answer with");
      if ("error" in status) throw status.error;
      return JSON.stringify({ versions: status.split });
    }
    if (command.startsWith("versions upload")) {
      const outputFile = extraEnv.WRANGLER_OUTPUT_FILE_PATH ?? "";
      writeFileSync(outputFile, `${JSON.stringify({ type: "version-upload", version_id: NEW })}\n`);
    }
    return "";
  };
  return { wrangler, calls };
}

const serving = (version: string): Status => ({ split: [{ version_id: version, percentage: 100 }] });

function target(name: WorkerName, environment: Environment, wrangler: Wrangler) {
  return { worker: workerNamed(name), environment, wrangler };
}

describe("the version serving now", () => {
  it("is the one taking all the traffic", () => {
    const { wrangler } = fakeWorker(serving(OLD));
    expect(currentVersion(target("mm-api", "production", wrangler))).toBe(OLD);
  });

  it("reads as never deployed only for an app whose surface is not switched on there", () => {
    const { wrangler } = fakeWorker({ error: NOT_FOUND });
    expect(currentVersion(target("mm-ops", "production", wrangler))).toBe("");
  });

  it.each([
    ["mm-api", "production"],
    ["mm-site", "production"],
    ["mm-ops", "staging"],
  ] as const)("is an error for %s in %s, which serves a host there", (name, environment) => {
    const { wrangler } = fakeWorker({ error: NOT_FOUND });
    expect(() => currentVersion(target(name, environment, wrangler))).toThrow(
      `${name}-${environment} is not on the account`,
    );
  });

  it("is an error, not 'never deployed', when Cloudflare refuses the token", () => {
    const { wrangler } = fakeWorker({ error: UNAUTHORISED });
    expect(() => currentVersion(target("mm-tech", "production", wrangler))).toThrow("Command failed");
  });

  it("is asked for again when Cloudflare drops the reply, since asking changes nothing", () => {
    const { wrangler, calls } = fakeWorker({ error: LOST }, serving(OLD));
    expect(currentVersion(target("mm-app", "staging", wrangler))).toBe(OLD);
    expect(calls.filter((call) => call.startsWith("deployments status"))).toHaveLength(2);
  });

  it("is an error while traffic is split between two versions", () => {
    const split = [
      { version_id: NEW, percentage: 10 },
      { version_id: OLD, percentage: 90 },
    ];
    const { wrangler } = fakeWorker({ split });
    expect(() => currentVersion(target("mm-api", "production", wrangler))).toThrow("is mid-rollout");
  });
});

describe("shipping a Worker", () => {
  it("uploads a version and sends it all the traffic", () => {
    const { wrangler, calls } = fakeWorker(serving(OLD));
    expect(ship(target("mm-app", "staging", wrangler), "abc123", "staging abc123")).toBe(NEW);
    expect(calls.some((call) => call.startsWith("versions upload --tag abc123"))).toBe(true);
    expect(calls).toContain(`versions deploy ${NEW}@100 --yes --message staging abc123`);
  });

  it("leaves an app alone that is not deployed yet and need not be", () => {
    const { wrangler, calls } = fakeWorker({ error: NOT_FOUND });
    expect(ship(target("mm-tech", "production", wrangler), "abc123", "release abc123")).toBeNull();
    expect(calls.filter((call) => call.startsWith("versions"))).toEqual([]);
  });

  it("fails, rather than skipping the Worker, when Cloudflare cannot be asked", () => {
    const { wrangler, calls } = fakeWorker({ error: UNAUTHORISED });
    expect(() => ship(target("mm-ops", "staging", wrangler), "abc123", "staging abc123")).toThrow();
    expect(calls.filter((call) => call.startsWith("versions"))).toEqual([]);
  });
});

describe("rolling a Worker back", () => {
  it("puts the recorded version back at 100% whatever the release left serving", () => {
    const split = [
      { version_id: NEW, percentage: 10 },
      { version_id: OLD, percentage: 90 },
    ];
    const { wrangler, calls } = fakeWorker({ split });
    expect(restore(target("mm-api", "production", wrangler), OLD, "rollback")).toBe("restored");
    expect(calls).toContain(`versions deploy ${OLD}@100 --yes --message rollback`);
  });

  it("restores an app whose deploy failed after its new version went live", () => {
    const { wrangler, calls } = fakeWorker(serving(NEW));
    expect(restore(target("mm-app", "production", wrangler), OLD, "rollback")).toBe("restored");
    expect(calls).toContain(`versions deploy ${OLD}@100 --yes --message rollback`);
  });

  it("changes nothing where the recorded version still serves", () => {
    const { wrangler, calls } = fakeWorker(serving(OLD));
    expect(restore(target("mm-site", "production", wrangler), OLD, "rollback")).toBe("unchanged");
    expect(calls.filter((call) => call.startsWith("versions"))).toEqual([]);
  });

  it("has nothing to restore for a Worker that was not deployed before the release", () => {
    const { wrangler, calls } = fakeWorker({ error: NOT_FOUND });
    expect(restore(target("mm-ops", "production", wrangler), "", "rollback")).toBe("nothing to restore");
    expect(calls).toEqual([]);
  });
});
