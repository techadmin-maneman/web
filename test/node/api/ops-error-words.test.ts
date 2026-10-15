// The console's words for the API's refusals, against the codes its routes document (docs/openapi-ops.json, each
// answer's code named in its description: src/http/errors.ts's errorResponse). A code a route can answer has words in
// the console's content, by its own name or as the camel-cased key a screen words it by, so a new refusal is never
// said only as "That didn't go through"; and words for a code are for one some route answers, so none goes stale.

import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { codesNamed, ERROR_CODES } from "../../../src/http/errors.ts";
import { ANY_ROUTE } from "../../any-route.ts";

/** Codes a console route answers that the console has no words of its own for, and why none are needed. */
const UNSAID: Readonly<Record<string, string>> = {
  rate_limited: "POST /api/client-errors only: a page's own report of an error, which nobody sees answered",
};

interface Response {
  readonly description?: string;
  readonly content?: Record<string, { readonly schema?: { readonly allOf?: readonly unknown[] } }>;
}

/** Each code a console route documents, with the answers that name it. */
function documented(): Map<string, string[]> {
  const spec = JSON.parse(readFileSync("docs/openapi-ops.json", "utf8")) as {
    paths: Record<string, Record<string, { responses?: Record<string, Response> }>>;
  };
  const codes = new Map<string, string[]>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (Number(status) < 400) continue;
        for (const code of codesNamed(response.description ?? "")) {
          codes.set(code, [...(codes.get(code) ?? []), `${method.toUpperCase()} ${path} ${status}`]);
        }
      }
    }
  }
  return codes;
}

const KNOWN = new Set<string>(ERROR_CODES);
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Each code the console has words for, by the key its content gives them, and where. */
const worded = new Map<string, { readonly where: string; readonly asNamed: boolean }[]>();

beforeAll(async () => {
  for (const file of readdirSync("apps/ops/src/content")) {
    const exports = (await import(/* @vite-ignore */ `../../../apps/ops/src/content/${file}`)) as Record<
      string,
      unknown
    >;
    const walk = (value: unknown, at: string, seen: Set<unknown>) => {
      if (typeof value !== "object" || value === null || seen.has(value)) return;
      seen.add(value);
      for (const [key, each] of Object.entries(value)) {
        const code = KNOWN.has(key) ? key : snake(key);
        if (KNOWN.has(code) && (typeof each === "string" || typeof each === "function")) {
          worded.set(code, [...(worded.get(code) ?? []), { where: `${file}: ${at}.${key}`, asNamed: key === code }]);
        }
        walk(each, `${at}.${key}`, seen);
      }
    };
    for (const [name, value] of Object.entries(exports)) walk(value, name, new Set());
  }
});

describe("the console's words for a refusal", () => {
  const codes = documented();
  const anyRoute = new Set(Object.values(ANY_ROUTE).flat());

  it("cover every code a console route answers", () => {
    expect(codes.size).toBeGreaterThan(40);
    const unsaid = [...codes.keys()].filter((code) => !worded.has(code) && !anyRoute.has(code) && !(code in UNSAID));
    expect(unsaid.map((code) => `${code}: ${codes.get(code)?.slice(0, 3).join(", ") ?? ""}`)).toEqual([]);
  });

  // A key spelt as a code is that code's words; a camel-cased one may be a label that only looks like one.
  it("are each for a code some route answers", () => {
    const stale = [...worded.entries()].filter(
      ([code, places]) => !codes.has(code) && !anyRoute.has(code) && places.some((place) => place.asNamed),
    );
    expect(stale.map(([code, places]) => `${code}: ${places.map((place) => place.where).join(", ")}`)).toEqual([]);
  });

  it("leave unsaid only codes the console never shows", () => {
    for (const code of Object.keys(UNSAID)) expect(codes.has(code), code).toBe(true);
  });
});
