// Contract: the committed OpenAPI document and docs/api.md are exactly what the
// zod schemas generate. Run `npm run openapi` when this fails.

import { describe, expect, it } from "vitest";
import committedMarkdown from "../../docs/api.md?raw";
import committedDocument from "../../docs/openapi.json";
import { buildOpenApiDocument, readResponse, renderApiMarkdown } from "../../src/openapi.ts";

describe("generated API documentation", () => {
  it("docs/openapi.json matches the schemas", () => {
    expect(JSON.parse(JSON.stringify(buildOpenApiDocument()))).toEqual(committedDocument);
  });

  it("docs/api.md matches the schemas", () => {
    expect(renderApiMarkdown(buildOpenApiDocument())).toBe(committedMarkdown.replace(/\r\n/g, "\n"));
  });

  it("documents every GET response with a JSON schema, or as an image", () => {
    const document = buildOpenApiDocument();
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const [status, response] of Object.entries(item.get?.responses ?? {}) as [string, unknown][]) {
        const types = Object.keys((response as { content?: Record<string, unknown> }).content ?? {});
        const isImage = types.length > 0 && types.every((type) => type.startsWith("image/"));
        if (!isImage) expect(readResponse(response).jsonSchema, `${path} ${status}`).toBeDefined();
      }
    }
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Health", "ErrorResponse"]),
    );
  });
});
