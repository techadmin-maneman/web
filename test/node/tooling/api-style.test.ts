// The API style (docs/api-style.md), held against the documents `npm run openapi` writes: every route of every surface
// keeps the rules, but for those the baseline lists (./api-style-baseline.ts). A new route that breaks one fails here;
// a baseline line whose route has since been put right fails too, so the baseline only shrinks.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_STYLE_BASELINE, WRITING_READS } from "./api-style-baseline.ts";

const DOCUMENTS = ["openapi.json", "openapi-client.json", "openapi-ops.json", "openapi-tech.json"] as const;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface Schema {
  readonly $ref?: string;
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly anyOf?: readonly Schema[];
  readonly oneOf?: readonly Schema[];
}

interface Operation {
  readonly parameters?: readonly { readonly name: string; readonly in: string }[];
  readonly requestBody?: { readonly content?: Readonly<Record<string, unknown>> };
  readonly responses?: Readonly<
    Record<string, { readonly content?: { readonly "application/json"?: { schema: Schema } } }>
  >;
}

interface Document {
  readonly paths: Readonly<Record<string, Readonly<Partial<Record<(typeof METHODS)[number], Operation>>>>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> };
}

/** One route of one document, as the rules read it. */
interface Route {
  readonly document: string;
  readonly method: (typeof METHODS)[number];
  readonly path: string;
  readonly operation: Operation;
  /** Whether a GET reads the same path: a POST to it is a create. */
  readonly collection: boolean;
  readonly resolve: (schema: Schema | undefined) => Schema | undefined;
}

function routesOf(document: string): Route[] {
  const doc = JSON.parse(readFileSync(`docs/${document}`, "utf8")) as Document;
  const resolve = (schema: Schema | undefined): Schema | undefined =>
    schema?.$ref === undefined ? schema : resolve(doc.components?.schemas?.[schema.$ref.split("/").at(-1) ?? ""]);
  return Object.entries(doc.paths).flatMap(([path, operations]) =>
    METHODS.flatMap((method) => {
      const operation = operations[method];
      if (operation === undefined) return [];
      return [{ document, method, path, operation, collection: operations.get !== undefined, resolve }];
    }),
  );
}

const ROUTES = DOCUMENTS.flatMap(routesOf);
const callOf = (route: Route) => `${route.document} ${route.method.toUpperCase()} ${route.path}`;
const lastOf = (route: Route) => route.path.split("/").at(-1) ?? "";
const successOf = (route: Route) =>
  Object.keys(route.operation.responses ?? {}).find((status) => status.startsWith("2"));
const answerOf = (route: Route) => {
  const status = successOf(route);
  return route.resolve(
    status === undefined ? undefined : route.operation.responses?.[status]?.content?.["application/json"]?.schema,
  );
};

/** Each shape an answer may take: itself, or each of its branches. */
const shapesOf = (route: Route, schema: Schema | undefined): Schema[] => {
  const resolved = route.resolve(schema);
  if (resolved === undefined) return [];
  const branches = resolved.anyOf ?? resolved.oneOf;
  return branches === undefined ? [resolved] : branches.flatMap((branch) => shapesOf(route, branch));
};

/** Each rule: whether a route breaks it. */
const RULES: Readonly<Record<string, (route: Route) => boolean>> = {
  "no-surface-prefix": (route) => /^\/api\/(tech|ops|client)\//.test(route.path),
  "delete-by-method": (route) => route.method === "post" && ["delete", "remove"].includes(lastOf(route)),
  "delete-204": (route) => route.method === "delete" && successOf(route) !== "204",
  "create-201": (route) =>
    route.method === "post" && route.collection && !lastOf(route).startsWith("{") && successOf(route) !== "201",
  "command-204": (route) => {
    if (route.method === "get" || successOf(route) !== "200") return false;
    const fields = Object.values(answerOf(route)?.properties ?? {});
    const field = fields.length === 1 ? route.resolve(fields[0]) : undefined;
    return field !== undefined && (field.type === "boolean" || field.enum?.length === 1);
  },
  "one-decision-verb": (route) => route.method === "post" && ["decide", "ruling"].includes(lastOf(route)),
  "put-for-files": (route) =>
    route.method === "put" && Object.keys(route.operation.requestBody?.content ?? {}).includes("application/json"),
  paging: (route) =>
    (route.operation.parameters ?? []).some(
      (each) => each.in === "query" && ["before", "offset", "page"].includes(each.name),
    ),
  "code-check": (route) =>
    Object.values(route.operation.responses ?? {}).some((response) =>
      shapesOf(route, response.content?.["application/json"]?.schema).some(
        (shape) => shape.properties?.attempts_left !== undefined && shape.properties.verified === undefined,
      ),
    ),
};

/** Every route that breaks a rule today, as "rule document METHOD path"; the tech app's prefix once for the surface. */
const broken = Object.entries(RULES).flatMap(([rule, breaks]) => {
  const routes = ROUTES.filter(breaks);
  if (rule === "no-surface-prefix") return [...new Set(routes.map((route) => `${rule} ${route.document}`))];
  return routes.map((route) => `${rule} ${callOf(route)}`);
});

describe("the API style", () => {
  it("reads every surface's routes", () => {
    for (const document of DOCUMENTS) expect(ROUTES.some((route) => route.document === document)).toBe(true);
  });

  it("is kept by every route the baseline does not list", () => {
    expect(broken.filter((line) => !API_STYLE_BASELINE.includes(line))).toEqual([]);
  });

  it("lists no route on the baseline that keeps it now, so the baseline only shrinks", () => {
    expect(API_STYLE_BASELINE.filter((line) => !broken.includes(line))).toEqual([]);
  });

  it("names each GET that writes, which no rule can see, while it is still a route", () => {
    expect(WRITING_READS.filter((call) => !ROUTES.map(callOf).includes(call))).toEqual([]);
  });
});
