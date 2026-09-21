// Serves a built site the way the mm-site Worker's static assets do, for the
// browser tests.
//
//   node scripts/serve-site.ts --env local --port 4321

import { parseArgs } from "node:util";
import { serveDirectory } from "./lib/static-server.ts";

const { values } = parseArgs({
  options: { env: { type: "string", default: "local" }, port: { type: "string", default: "4321" } },
});
const directory = `site/dist/${values.env}`;
await serveDirectory(directory, Number(values.port));
console.log(`serving ${directory} on http://127.0.0.1:${values.port}`);
