// Serves a built site the way the mm-site Worker's static assets do, for the
// browser tests.
//
//   node scripts/dev/serve-site.ts --env local --port 4321 [--api http://127.0.0.1:8787]
//
// With --api, /api/* goes to that mm-api, so the page and the API share an
// origin as they do behind Cloudflare.

import { parseArgs } from "node:util";
import { serveDirectory } from "../lib/static-server.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    port: { type: "string", default: "4321" },
    api: { type: "string" },
  },
});
const directory = `site/dist/${values.env}`;
await serveDirectory(directory, Number(values.port), values.api);
console.log(
  `serving ${directory} on http://127.0.0.1:${values.port}${values.api === undefined ? "" : `, /api/* from ${values.api}`}`,
);
