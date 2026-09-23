// Serves the built technician app the way the mm-tech Worker's static assets
// do, for the browser tests: any page path answers index.html, and /api/* goes
// to mm-api with the browser's own Host, as Cloudflare's routing keeps it.
//
//   node scripts/serve-tech.ts --env local --port 4324 --api http://127.0.0.1:8787

import { parseArgs } from "node:util";
import { serveDirectory } from "./lib/static-server.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    port: { type: "string", default: "4324" },
    api: { type: "string" },
  },
});
const directory = `apps/tech/dist/${values.env}`;
await serveDirectory(directory, Number(values.port), values.api, { spa: true, keepHost: true });
console.log(`serving ${directory} on http://tech.localhost:${values.port}`);
