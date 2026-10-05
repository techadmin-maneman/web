// Serves the built client app the way the mm-app Worker's static assets do,
// for the browser tests: any page path answers index.html, and /api/* goes to
// mm-api with the browser's own Host, as Cloudflare's routing keeps it.
//
//   node scripts/dev/serve-app.ts --env local --port 4322 --api http://127.0.0.1:8787

import { parseArgs } from "node:util";
import { serveDirectory } from "../lib/static-server.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    port: { type: "string", default: "4322" },
    api: { type: "string" },
  },
});
const directory = `apps/app/dist/${values.env}`;
await serveDirectory(directory, Number(values.port), values.api, { spa: true, keepHost: true });
console.log(`serving ${directory} on http://app.localhost:${values.port}`);
