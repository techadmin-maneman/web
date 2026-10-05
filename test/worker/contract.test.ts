// Contract: each committed OpenAPI document and its Markdown twin are exactly
// what the zod schemas generate. Run `npm run openapi` when this fails.

import { describe, expect, it } from "vitest";
import clientMarkdown from "../../docs/api-client.md?raw";
import opsMarkdown from "../../docs/api-ops.md?raw";
import techMarkdown from "../../docs/api-tech.md?raw";
import publicMarkdown from "../../docs/api.md?raw";
import clientDocument from "../../docs/openapi-client.json";
import opsDocument from "../../docs/openapi-ops.json";
import techDocument from "../../docs/openapi-tech.json";
import publicDocument from "../../docs/openapi.json";
import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from "../../src/http/errors.ts";
import { buildOpenApiDocument, readResponse, renderApiMarkdown, type DocumentedSurface } from "../../src/openapi.ts";

/** A schema as far as this test reads one: a reference, or an object's fields and whether it allows others. */
interface Part {
  readonly $ref?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly additionalProperties?: unknown;
}

const refName = (ref: string) => ref.replace("#/components/schemas/", "");

const COMMITTED: readonly [DocumentedSurface, unknown, string][] = [
  ["public", publicDocument, publicMarkdown],
  ["client", clientDocument, clientMarkdown],
  ["ops", opsDocument, opsMarkdown],
  ["tech", techDocument, techMarkdown],
];

describe.each(COMMITTED)("the %s surface's API documentation", (surface, document, markdown) => {
  it("is the OpenAPI document the schemas generate", () => {
    expect(JSON.parse(JSON.stringify(buildOpenApiDocument(surface)))).toEqual(document);
  });

  it("is the Markdown the schemas generate", () => {
    expect(renderApiMarkdown(buildOpenApiDocument(surface))).toBe(markdown.replace(/\r\n/g, "\n"));
  });

  // P3-44: eight bodies were optional, so a request sent without JSON reached its handler as an empty one.
  it("requires the body of every write that takes one", () => {
    const generated = buildOpenApiDocument(surface);
    const optional = Object.entries(generated.paths ?? {}).flatMap(([path, item]) =>
      (["post", "put", "patch"] as const)
        .filter((method) => {
          const body = item[method]?.requestBody;
          return body !== undefined && !("$ref" in body) && body.required !== true;
        })
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(optional).toEqual([]);
  });

  it("documents every GET response with a JSON schema, or as an image, a PDF, a page, a redirect or no content", () => {
    const generated = buildOpenApiDocument(surface);
    for (const [path, item] of Object.entries(generated.paths ?? {})) {
      for (const [status, response] of Object.entries(item.get?.responses ?? {}) as [string, unknown][]) {
        const types = Object.keys((response as { content?: Record<string, unknown> }).content ?? {});
        // A page is a file too: a client's data export, readable, downloads as one.
        const isFile =
          types.length > 0 &&
          types.every((type) => type.startsWith("image/") || type === "application/pdf" || type === "text/html");
        // A redirect has no body: the invite's preview sends the house card to the site (ADR 0048).
        const isRedirect = status.startsWith("3") && types.length === 0;
        const isNoContent = status === "204" && types.length === 0;
        if (!isFile && !isRedirect && !isNoContent) {
          expect(readResponse(response).jsonSchema, `${path} ${status}`).toBeDefined();
        }
      }
    }
    expect(Object.keys(generated.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Health", "ErrorResponse"]),
    );
  });

  it("describes no answer as closed parts joined by allOf, which no real answer could ever meet", () => {
    // A closed part refuses every field another part adds, so a validator would reject each real response.
    const generated = buildOpenApiDocument(surface);
    const components: Readonly<Record<string, Part>> = generated.components?.schemas ?? {};
    const resolve = (part: Part): Part => (part.$ref === undefined ? part : (components[refName(part.$ref)] ?? part));
    const refuses = (closed: Part, other: Part) =>
      closed.additionalProperties === false &&
      Object.keys(other.properties ?? {}).some((field) => !(field in (closed.properties ?? {})));
    const unmeetable: string[] = [];
    JSON.stringify(generated, (key, value: unknown) => {
      const parts = key === "allOf" && Array.isArray(value) ? (value as Part[]).map(resolve) : [];
      if (parts.some((closed) => parts.some((other) => refuses(closed, other)))) unmeetable.push(JSON.stringify(value));
      return value;
    });
    expect(unmeetable).toEqual([]);
  });
});

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);
const isErrorCode = (code: string): code is ErrorCode => KNOWN_CODES.has(code);

/**
 * The error codes an answer's description names. Each clause opens with one, "taken: that window has gone; or
 * ops_assisted", and the words after it are prose, even one spelled like a code: "none made, taken down".
 */
function codesNamedIn(description: string): string[] {
  return description
    .split(/;|\. |, or /)
    .map(
      (clause) =>
        clause
          .trim()
          .replace(/^or /, "")
          .split(/[\s:,]/)[0] ?? "",
    )
    .filter((word) => KNOWN_CODES.has(word));
}

/** Each error answer on every surface: where it is, its status, and its description. */
function errorAnswers(): { where: string; status: string; description: string }[] {
  return COMMITTED.flatMap(([surface]) =>
    Object.entries(buildOpenApiDocument(surface).paths ?? {}).flatMap(([path, item]) =>
      METHODS.flatMap((method) =>
        Object.entries(item[method]?.responses ?? {})
          .filter(([, response]) => JSON.stringify(response).includes("#/components/schemas/ErrorResponse"))
          .map(([status, response]) => ({
            where: `${surface} ${method.toUpperCase()} ${path}`,
            status,
            description: readResponse(response).description,
          })),
      ),
    ),
  );
}

// Open point 105, ruled by the owner on 27 September 2026: a front end reads an error by its code, and each code
// answers with one status everywhere, so that neither can say something the other does not.
describe("the error codes", () => {
  it("are read from the first word of each clause of an answer's description", () => {
    expect(codesNamedIn("taken: that window has gone; hold_expired: it lapsed; or ops_assisted")).toEqual([
      "taken",
      "hold_expired",
      "ops_assisted",
    ]);
    expect(codesNamedIn("superseded: the board is out of date. not_changeable: the visit has begun")).toEqual([
      "superseded",
      "not_changeable",
    ]);
    expect(codesNamedIn("too_early, or rate_limited")).toEqual(["too_early", "rate_limited"]);
    expect(codesNamedIn("not_found: none made, taken down, or erased")).toEqual(["not_found"]);
  });

  // An answer that names no code cannot be held to one status by the test below.
  it("are each named by the description of every error answer", () => {
    const unnamed = errorAnswers().filter(({ description }) => codesNamedIn(description).length === 0);
    expect(unnamed).toEqual([]);
  });

  // P3-44: each code's status was read from the documents; now the routes answer it from one table, held to them here.
  it("each answer with the status ERROR_STATUS gives it, on every surface", () => {
    const elsewhere = errorAnswers().flatMap(({ where, status, description }) =>
      codesNamedIn(description)
        .filter(isErrorCode)
        .filter((code) => String(ERROR_STATUS[code]) !== status)
        .map((code) => `${where}: ${code} under ${status}, not ${String(ERROR_STATUS[code])}`),
    );
    expect(elsewhere).toEqual([]);
  });
});
