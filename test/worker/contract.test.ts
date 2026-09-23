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
import { buildOpenApiDocument, readResponse, renderApiMarkdown, type DocumentedSurface } from "../../src/openapi.ts";

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

  it("documents every GET response with a JSON schema, or as an image, a PDF or a redirect", () => {
    const generated = buildOpenApiDocument(surface);
    for (const [path, item] of Object.entries(generated.paths ?? {})) {
      for (const [status, response] of Object.entries(item.get?.responses ?? {}) as [string, unknown][]) {
        const types = Object.keys((response as { content?: Record<string, unknown> }).content ?? {});
        const isFile =
          types.length > 0 && types.every((type) => type.startsWith("image/") || type === "application/pdf");
        // A redirect has no body: the invite's preview sends the house card to the site (ADR 0048).
        const isRedirect = status.startsWith("3") && types.length === 0;
        if (!isFile && !isRedirect) expect(readResponse(response).jsonSchema, `${path} ${status}`).toBeDefined();
      }
    }
    expect(Object.keys(generated.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Health", "ErrorResponse"]),
    );
  });
});
