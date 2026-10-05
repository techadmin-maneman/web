// Every answer a Worker test has from a route, held to the reply the route documents (CQ-54): a handler that misses a
// field its schema promises, or answers a status the route never documented, fails the test that met it. The browser
// tests check the same against the committed documents (e2e/contract.ts); this checks every route the Worker tests
// reach, against the schemas the documents are written from.

import type { App } from "../../src/http/context.ts";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import { ANY_ROUTE } from "../any-route.ts";

interface Issue {
  readonly code: string;
  readonly format?: string;
  readonly path: PropertyKey[];
  readonly message: string;
}

interface Parser {
  safeParse(value: unknown): {
    success: boolean;
    error?: { issues: readonly Issue[] };
  };
}

interface Documented {
  readonly method: string;
  readonly path: string;
  readonly pattern: RegExp;
  readonly replies: Readonly<Record<string, Parser | null>>;
}

/**
 * A test's hand-written ID ("v1") is no UUID, which a schema promises of a real one, made by crypto.randomUUID: an
 * ID's form is the browser tests' to check, against fakes written as the API writes them.
 */
const isTestsOwnId = (issue: Issue) => issue.code === "invalid_format" && issue.format === "uuid";

const isParser = (value: unknown): value is Parser =>
  typeof value === "object" && value !== null && "safeParse" in value;

const documentedOf = new WeakMap<App, readonly Documented[]>();

/** A documented path's segments as a pattern: `{id}` stands for any one segment. */
const patternOf = (path: string) => new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+").replace(/\//g, "\\/")}$`);

function documented(app: App): readonly Documented[] {
  const known = documentedOf.get(app);
  if (known !== undefined) return known;
  const routes = app.openAPIRegistry.definitions.flatMap((definition) => {
    if (definition.type !== "route") return [];
    const { method, path, responses } = definition.route;
    const replies = Object.fromEntries(
      Object.entries(responses).map(([status, reply]) => {
        const media: unknown = "content" in reply ? reply.content?.["application/json"] : undefined;
        const schema: unknown = typeof media === "object" && media !== null && "schema" in media ? media.schema : null;
        return [status, isParser(schema) ? schema : null];
      }),
    );
    // The most literal path first, so /api/technicians/work is not read as /api/technicians/{id}.
    return [{ method: method.toUpperCase(), path, pattern: patternOf(path), replies }];
  });
  routes.sort((a, b) => a.path.split("{").length - b.path.split("{").length);
  documentedOf.set(app, routes);
  return routes;
}

const errorCode = (body: unknown): string | null => {
  const parsed = ErrorResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
};

/** Why the route's answer is not what it documents; empty when it is. A path no route documents is not checked. */
export async function outsideContract(app: App, method: string, path: string, response: Response): Promise<string[]> {
  const pathname = new URL(path, "https://maneman.test").pathname;
  const route = documented(app).find((each) => each.method === method && each.pattern.test(pathname));
  if (route === undefined) return [];
  const label = `${method} ${route.path} ${String(response.status)}`;
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const body: unknown = isJson
    ? await response
        .clone()
        .json()
        .catch(() => undefined)
    : undefined;

  const anyRoute = ANY_ROUTE[response.status];
  const code = errorCode(body);
  if (anyRoute !== undefined && code !== null && anyRoute.includes(code)) return [];
  if (!(String(response.status) in route.replies)) {
    return [`${label}: the route never documents ${String(response.status)}${code === null ? "" : ` (${code})`}`];
  }
  const schema = route.replies[String(response.status)];
  if (schema === null || schema === undefined || !isJson) return [];
  const parsed = schema.safeParse(body);
  if (parsed.success) return [];
  return (parsed.error?.issues ?? [])
    .filter((issue) => !isTestsOwnId(issue))
    .map((issue) => `${label}: ${issue.path.map(String).join(".") || "(root)"} ${issue.message}`);
}
