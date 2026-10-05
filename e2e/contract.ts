// The replies the browser tests fake, held to the committed OpenAPI documents, so
// a fake cannot answer what mm-api never would: a route it does not have, a status
// it does not send, or a body of another shape. Every object is read as closed,
// as the zod schemas write them, so a fake that adds a field the API never sends
// fails too (TCD-01).
//
// The same documents type the fakes at compile time: each fixture `satisfies`
// its route's reply (Reply below), and this file checks the rest as they are sent.

import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export type Surface = "public" | "client" | "ops" | "tech";

const DOCUMENTS: Readonly<Record<Surface, string>> = {
  public: "docs/openapi.json",
  client: "docs/openapi-client.json",
  ops: "docs/openapi-ops.json",
  tech: "docs/openapi-tech.json",
};

type JsonBody<Response> = Response extends { content: { "application/json": infer Body } } ? Body : never;

/** The JSON body `method path` answers with `status`, from a surface's generated `paths` (apps/<app>/src/api-schema.ts). */
export type Reply<
  Paths,
  Path extends keyof Paths,
  Method extends keyof Paths[Path],
  Status extends number = 200,
> = Paths[Path][Method] extends { responses: infer Responses }
  ? Status extends keyof Responses
    ? JsonBody<Responses[Status]>
    : never
  : never;

interface Operation {
  readonly responses?: Readonly<Record<string, { content?: Readonly<Record<string, { schema?: unknown }>> }>>;
}

interface Document {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
}

/** Every object with properties and nothing said of others is closed, as the zod schemas mean it. */
function closed(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closed);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = closed(value);
  if (out.type === "object" && out.properties !== undefined && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

interface Loaded {
  readonly document: Document;
  readonly ajv: Ajv2020;
  readonly compiled: Map<string, ValidateFunction>;
}

const loaded = new Map<Surface, Loaded>();

function load(surface: Surface): Loaded {
  const known = loaded.get(surface);
  if (known !== undefined) return known;
  const document = JSON.parse(readFileSync(DOCUMENTS[surface], "utf8")) as Document;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: surface, ...(closed(document) as object) });
  const fresh = { document, ajv, compiled: new Map<string, ValidateFunction>() };
  loaded.set(surface, fresh);
  return fresh;
}

/** A documented path's segments as a pattern: `{id}` stands for any one segment. */
function pattern(documented: string): RegExp {
  const segments = documented.split("/").map((segment) => (/^\{.+\}$/.test(segment) ? "[^/]+" : segment));
  return new RegExp(`^${segments.join("/")}$`);
}

/**
 * The documented path a request is for: of those its path fits and that take its method, the most literal, so
 * /api/technicians/work is not read as /api/technicians/{id}.
 */
export function documentedPath(surface: Surface, method: string, pathname: string): string | null {
  const { paths } = load(surface).document;
  const placeholders = (path: string) => path.split("{").length;
  const fits = Object.keys(paths)
    .filter((path) => pattern(path).test(pathname) && paths[path]?.[method.toLowerCase()] !== undefined)
    .sort((a, b) => placeholders(a) - placeholders(b));
  return fits[0] ?? null;
}

/**
 * What every /api/* route can answer besides its own documented replies (src/app.ts): the error handler's 500, and
 * the database check's 503, which runs before any route.
 */
const ANY_ROUTE: Readonly<Record<number, readonly string[]>> = {
  500: ["internal_error"],
  503: ["unavailable", "environment_mismatch"],
};

/** The code of an error body, `{ error: { code } }`, or null for any other body. */
function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const { error } = body;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function validator({ ajv, compiled }: Loaded, ref: string): ValidateFunction {
  const known = compiled.get(ref);
  if (known !== undefined) return known;
  const validate = ajv.compile({ $ref: ref });
  compiled.set(ref, validate);
  return validate;
}

function schemaErrors(surface: Surface, ref: string, label: string, body: unknown): string[] {
  const validate = validator(load(surface), ref);
  if (validate(body)) return [];
  return (validate.errors ?? []).map(
    (error) => `${label}: ${error.instancePath || "(root)"} ${error.message ?? ""} ${JSON.stringify(error.params)}`,
  );
}

/** Why `method pathname` answering `status` with `body` is not in the contract; empty when it is. */
export function contractErrors(
  surface: Surface,
  method: string,
  pathname: string,
  status: number,
  body?: unknown,
): string[] {
  const route = `${method.toUpperCase()} ${pathname} ${String(status)}`;
  const path = documentedPath(surface, method, pathname);
  const code = errorCode(body);
  // A path mm-api has no route for is its not-found answer, which a fake gives any call nobody agreed to.
  if (path === null)
    return status === 404 && code === "not_found" ? [] : [`${route}: no such route in ${DOCUMENTS[surface]}`];

  const anyRoute = ANY_ROUTE[status];
  if (anyRoute !== undefined && code !== null && anyRoute.includes(code)) {
    return schemaErrors(surface, `${surface}#/components/schemas/ErrorResponse`, route, body);
  }

  const response = load(surface).document.paths[path]?.[method.toLowerCase()]?.responses?.[String(status)];
  if (response === undefined) return [`${route}: ${path} never answers ${String(status)}`];
  if (body === undefined || response.content?.["application/json"] === undefined) return [];

  const pointer = [path, method.toLowerCase(), "responses", String(status), "content", "application/json", "schema"]
    .map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/");
  return schemaErrors(surface, `${surface}#/paths/${pointer}`, route, body);
}

/** Throws unless the contract says `method pathname` may answer `status` with `body`. */
export function assertInContract(
  surface: Surface,
  method: string,
  pathname: string,
  status: number,
  body?: unknown,
): void {
  const errors = contractErrors(surface, method, pathname, status, body);
  if (errors.length > 0) throw new Error(`A fake answered outside the API's contract:\n${errors.join("\n")}`);
}
