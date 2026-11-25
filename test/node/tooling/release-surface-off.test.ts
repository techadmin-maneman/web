// An app whose surface is off where it is released: production's, as it was before launch. The release reads it as not
// deployed and leaves it alone, bootstrapped there or not, since a build of it would be its placeholder copy.

import { describe, expect, it, vi } from "vitest";
import { currentVersion, ship, type Environment, type Wrangler } from "../../../scripts/lib/release.ts";
import { workerNamed, type WorkerName } from "../../../scripts/lib/workers.ts";

vi.mock("../../../src/config/environments.ts", async (original) => {
  const actual = await original<typeof import("../../../src/config/environments.ts")>();
  return { ...actual, ENABLED_SURFACES: { ...actual.ENABLED_SURFACES, production: ["public"] } };
});

const OLD = "11111111-1111-4111-8111-111111111111";

const NOT_FOUND_WORDS = "✘ [ERROR] This Worker does not exist on your account. [code: 10007]";
const NOT_FOUND = Object.assign(new Error(`Command failed: wrangler\n${NOT_FOUND_WORDS}`), { stderr: NOT_FOUND_WORDS });

type Status = { split: { version_id: string; percentage: number }[] } | { error: Error };

function fakeWorker(status: Status): { wrangler: Wrangler; calls: string[] } {
  const calls: string[] = [];
  const wrangler: Wrangler = (args) => {
    calls.push(args.join(" "));
    if ("error" in status) throw status.error;
    return JSON.stringify({ versions: status.split });
  };
  return { wrangler, calls };
}

const serving = (version: string): Status => ({ split: [{ version_id: version, percentage: 100 }] });

function target(name: WorkerName, environment: Environment, wrangler: Wrangler) {
  return { worker: workerNamed(name), environment, wrangler };
}

describe("an app whose surface is off", () => {
  it("reads as never deployed", () => {
    const { wrangler } = fakeWorker({ error: NOT_FOUND });
    expect(currentVersion(target("mm-ops", "production", wrangler))).toBe("");
  });

  it("reads as not deployed, even one bootstrapped there, and Cloudflare is not asked", () => {
    const { wrangler, calls } = fakeWorker(serving(OLD));
    expect(currentVersion(target("mm-app", "production", wrangler))).toBe("");
    expect(calls).toEqual([]);
  });

  it("is left alone by a release, deployed or not", () => {
    const missing = fakeWorker({ error: NOT_FOUND });
    expect(ship(target("mm-tech", "production", missing.wrangler), "abc123", "release abc123")).toBeNull();
    expect(missing.calls).toEqual([]);
    const bootstrapped = fakeWorker(serving(OLD));
    expect(ship(target("mm-app", "production", bootstrapped.wrangler), "abc123", "release abc123")).toBeNull();
    expect(bootstrapped.calls).toEqual([]);
  });
});
