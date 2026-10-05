// What the deploy workflows ask of scripts/release/release.ts, against a fake wrangler
// that answers as Cloudflare does. The workflows' shell only ever calls these,
// so a failure here is a deploy that would have gone wrong.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentVersion,
  deploySplit,
  restore,
  ship,
  uploadVersion,
  type Environment,
  type Wrangler,
} from "../../../scripts/lib/release.ts";
import { workerNamed, type WorkerName } from "../../../scripts/lib/workers.ts";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const EARLIER = "33333333-3333-4333-8333-333333333333";

/** A wrangler failure as execFileSync throws it: the command, then wrangler's own words, which are also on stderr. */
function wranglerError(stderr: string): Error {
  return Object.assign(new Error(`Command failed: wrangler\n${stderr}`), { stderr });
}

const NOT_FOUND = wranglerError("✘ [ERROR] This Worker does not exist on your account. [code: 10007]");
const UNAUTHORISED = wranglerError("✘ [ERROR] Authentication error [code: 10000]");
const LOST = wranglerError("✘ [ERROR] fetch failed: terminated");
const RESET = wranglerError("✘ [ERROR] read ECONNRESET");

/** The first line wrangler writes to WRANGLER_OUTPUT_FILE_PATH, before the one naming the version. */
const SESSION_LINE = JSON.stringify({ type: "wrangler-session", version: 1 });

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

  it("reads as not deployed for an app whose surface is off, even one bootstrapped there", () => {
    // mm-app-production was bootstrapped before its surface was switched on (docs/open-points.md,
    // item 152); a release that shipped it would build its placeholder copy and fail.
    const { wrangler, calls } = fakeWorker(serving(OLD));
    expect(currentVersion(target("mm-app", "production", wrangler))).toBe("");
    expect(calls).toEqual([]);
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
    expect(() => currentVersion(target("mm-tech", "staging", wrangler))).toThrow("Command failed");
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

  // A secret change publishes an untagged version, so the commit is baked into the code as well.
  it("bakes a commit's SHA into the bundle it uploads, and nothing that is not one", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { wrangler, calls } = fakeWorker(serving(OLD));
    ship(target("mm-api", "staging", wrangler), sha, `staging ${sha}`);
    expect(calls.find((call) => call.startsWith("versions upload"))).toContain(`--define BUILD_SHA:"${sha}"`);

    const other = fakeWorker(serving(OLD));
    ship(target("mm-api", "staging", other.wrangler), "hotfix 1", "staging hotfix");
    expect(other.calls.find((call) => call.startsWith("versions upload"))).not.toContain("--define");
  });

  it("leaves an app alone that is not deployed yet and need not be", () => {
    const { wrangler, calls } = fakeWorker({ error: NOT_FOUND });
    expect(ship(target("mm-tech", "production", wrangler), "abc123", "release abc123")).toBeNull();
    expect(calls.filter((call) => call.startsWith("versions"))).toEqual([]);
  });

  it("leaves an app alone whose surface is off, though it was bootstrapped there", () => {
    const { wrangler, calls } = fakeWorker(serving(OLD));
    expect(ship(target("mm-app", "production", wrangler), "abc123", "release abc123")).toBeNull();
    expect(calls).toEqual([]);
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

/** What became of a request: Cloudflare answered, did the work and the reply was lost, or the work never landed. */
type Reply = "answered" | "lost after landing" | "lost before landing";

interface AccountOptions {
  readonly serving?: string;
  readonly upload?: Reply;
  readonly deploy?: Reply;
  readonly listRepliesLost?: number;
}

function valueAfter(args: readonly string[], flag: string): string {
  return args[args.indexOf(flag) + 1] ?? "";
}

/**
 * A Worker whose versions and split change as Cloudflare's do. OLD was uploaded from the commit
 * "previous"; `serving` takes all the traffic at the start. An upload adds NEW under its tag.
 */
function fakeAccount(options: AccountOptions = {}) {
  const { serving = OLD, upload = "answered", deploy = "answered" } = options;
  const versions = [{ id: OLD, tag: "previous" }];
  let split = [{ version_id: serving, percentage: 100 }];
  let listRepliesToLose = options.listRepliesLost ?? 0;
  const calls: string[] = [];

  function answerUpload(args: readonly string[], outputFile: string): string {
    if (upload === "lost before landing") throw RESET;
    versions.push({ id: NEW, tag: valueAfter(args, "--tag") });
    if (upload === "lost after landing") throw RESET;
    writeFileSync(outputFile, `${SESSION_LINE}\n${JSON.stringify({ type: "version-upload", version_id: NEW })}\n`);
    return "";
  }

  function answerDeploy(args: readonly string[]): string {
    if (deploy === "lost before landing") throw RESET;
    split = args.slice(2, args.indexOf("--yes")).map((share) => {
      const [versionId = "", percentage = ""] = share.split("@");
      return { version_id: versionId, percentage: Number(percentage) };
    });
    if (deploy === "lost after landing") throw RESET;
    return "";
  }

  function answerList(): string {
    if (listRepliesToLose > 0) {
      listRepliesToLose--;
      throw RESET;
    }
    return JSON.stringify(versions.map(({ id, tag }) => ({ id, annotations: { "workers/tag": tag } })));
  }

  const wrangler: Wrangler = (args, extraEnv = {}) => {
    const command = args.join(" ");
    calls.push(command);
    if (command.startsWith("deployments status")) return JSON.stringify({ versions: split });
    if (command.startsWith("versions list")) return answerList();
    if (command.startsWith("versions upload")) return answerUpload(args, extraEnv.WRANGLER_OUTPUT_FILE_PATH ?? "");
    if (command.startsWith("versions deploy")) return answerDeploy(args);
    throw new Error(`the fake account does not answer "${command}"`);
  };
  return { wrangler, calls, versions, split: () => split };
}

function callsTo(calls: readonly string[], command: string): string[] {
  return calls.filter((call) => call.startsWith(command));
}

describe("an upload whose reply Cloudflare drops", () => {
  it("takes the version that landed instead of uploading a second", () => {
    const account = fakeAccount({ upload: "lost after landing" });
    expect(uploadVersion(target("mm-api", "production", account.wrangler), "abc123", "release abc123")).toBe(NEW);
    expect(callsTo(account.calls, "versions upload")).toHaveLength(1);
    expect(account.versions).toHaveLength(2);
  });

  it("fails, without uploading again, when the upload never landed", () => {
    const account = fakeAccount({ upload: "lost before landing" });
    expect(() => uploadVersion(target("mm-api", "production", account.wrangler), "abc123", "release abc123")).toThrow(
      "ECONNRESET",
    );
    expect(callsTo(account.calls, "versions upload")).toHaveLength(1);
    expect(account.versions).toHaveLength(1);
  });

  it("asks again what landed when that reply is lost too", () => {
    const account = fakeAccount({ upload: "lost after landing", listRepliesLost: 1 });
    expect(uploadVersion(target("mm-site", "staging", account.wrangler), "abc123", "staging abc123")).toBe(NEW);
    expect(callsTo(account.calls, "versions list")).toHaveLength(2);
  });

  it("takes the newest version with the tag where the same commit was uploaded before", () => {
    const account = fakeAccount({ upload: "lost after landing" });
    account.versions.push({ id: EARLIER, tag: "abc123" });
    expect(uploadVersion(target("mm-api", "staging", account.wrangler), "abc123", "staging abc123")).toBe(NEW);
  });

  it("fails at once on an error that is not a lost reply", () => {
    const calls: string[] = [];
    const wrangler: Wrangler = (args) => {
      calls.push(args.join(" "));
      throw UNAUTHORISED;
    };
    expect(() => uploadVersion(target("mm-api", "staging", wrangler), "abc123", "staging abc123")).toThrow(
      "code: 10000",
    );
    expect(calls).toEqual(["versions upload --tag abc123 --message staging abc123"]);
  });

  it("is an error when wrangler names no version", () => {
    const wrangler: Wrangler = (_args, extraEnv = {}) => {
      writeFileSync(extraEnv.WRANGLER_OUTPUT_FILE_PATH ?? "", `${SESSION_LINE}\n`);
      return "";
    };
    expect(() => uploadVersion(target("mm-api", "staging", wrangler), "abc123", "staging abc123")).toThrow(
      "wrangler did not report the uploaded version",
    );
  });
});

describe("a split whose reply Cloudflare drops", () => {
  it("passes when the version asked for already takes all the traffic", () => {
    const account = fakeAccount({ deploy: "lost after landing" });
    expect(() => {
      deploySplit(target("mm-api", "production", account.wrangler), [`${NEW}@100`], "release abc123");
    }).not.toThrow();
    expect(account.split()).toEqual([{ version_id: NEW, percentage: 100 }]);
  });

  it("fails when the split never landed", () => {
    const account = fakeAccount({ deploy: "lost before landing" });
    expect(() => {
      deploySplit(target("mm-api", "production", account.wrangler), [`${NEW}@100`], "release abc123");
    }).toThrow("ECONNRESET");
    expect(account.split()).toEqual([{ version_id: OLD, percentage: 100 }]);
  });

  it("fails on a canary split, which the version serving cannot confirm, and the release rolls back", () => {
    const account = fakeAccount({ deploy: "lost after landing" });
    expect(() => {
      deploySplit(target("mm-api", "production", account.wrangler), [`${NEW}@10`, `${OLD}@90`], "canary");
    }).toThrow("ECONNRESET");
    expect(callsTo(account.calls, "deployments status")).toEqual([]);
  });

  it.each<{ what: string; splits: string[] }>([
    { what: "no shares", splits: [] },
    { what: "shares short of 100", splits: [`${NEW}@50`] },
    { what: "a share that names no version", splits: ["latest@100"] },
  ])("refuses $what before asking Cloudflare", ({ splits }) => {
    const account = fakeAccount();
    expect(() => {
      deploySplit(target("mm-api", "production", account.wrangler), splits, "release abc123");
    }).toThrow("--split must be");
    expect(account.calls).toEqual([]);
  });
});

describe("a release and a rollback whose replies Cloudflare drops", () => {
  it("ships one version though the upload's and the deploy's replies were both lost", () => {
    const account = fakeAccount({ upload: "lost after landing", deploy: "lost after landing" });
    expect(ship(target("mm-api", "production", account.wrangler), "abc123", "release abc123")).toBe(NEW);
    expect(callsTo(account.calls, "versions upload")).toHaveLength(1);
    expect(account.split()).toEqual([{ version_id: NEW, percentage: 100 }]);
  });

  it("rolls back though the reply was lost once the old version was serving again", () => {
    const account = fakeAccount({ serving: NEW, deploy: "lost after landing" });
    expect(restore(target("mm-api", "production", account.wrangler), OLD, "rollback")).toBe("restored");
    expect(account.split()).toEqual([{ version_id: OLD, percentage: 100 }]);
  });

  it("fails the rollback when the old version did not go back", () => {
    const account = fakeAccount({ serving: NEW, deploy: "lost before landing" });
    expect(() => restore(target("mm-api", "production", account.wrangler), OLD, "rollback")).toThrow("ECONNRESET");
    expect(account.split()).toEqual([{ version_id: NEW, percentage: 100 }]);
  });
});
