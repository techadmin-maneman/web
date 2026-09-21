// Writes docs/openapi.json and docs/api.md from the zod route schemas.
//   npm run openapi

import { writeFileSync } from "node:fs";
import { buildOpenApiDocument, renderApiMarkdown } from "../src/openapi.ts";

const document = buildOpenApiDocument();
writeFileSync("docs/openapi.json", `${JSON.stringify(document, null, 2)}\n`);
writeFileSync("docs/api.md", renderApiMarkdown(document));
console.log("wrote docs/openapi.json and docs/api.md");
