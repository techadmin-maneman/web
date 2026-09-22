// Writes each surface's OpenAPI document and its Markdown twin from the zod
// route schemas: docs/openapi.json and docs/api.md for the public site,
// docs/openapi-client.json and docs/api-client.md for the client app.
//   npm run openapi

import { writeFileSync } from "node:fs";
import {
  buildOpenApiDocument,
  DOCUMENTED_SURFACES,
  renderApiMarkdown,
  type DocumentedSurface,
} from "../src/openapi.ts";

for (const surface of Object.keys(DOCUMENTED_SURFACES) as DocumentedSurface[]) {
  const document = buildOpenApiDocument(surface);
  const { json, markdown } = DOCUMENTED_SURFACES[surface];
  writeFileSync(json, `${JSON.stringify(document, null, 2)}\n`);
  writeFileSync(markdown, renderApiMarkdown(document));
  console.log(`wrote ${json} and ${markdown}`);
}
