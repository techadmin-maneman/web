// Builds the ops console for one environment into apps/ops/dist/<environment>,
// with its _headers (docs/decisions/0026-hosts-and-surfaces.md). Production is
// refused while its copy is marked PLACEHOLDER, and any build whose JavaScript
// is over the prompt's 150 KB gzipped fails, as the client app's does
// (scripts/lib/spa-build.ts).
//
//   npm run build:ops -- --env staging

import { headersFile } from "@maneman/web-kit/headers";
import { OPS_CONSOLE_POLICY } from "../apps/ops/headers.ts";
import { buildOptions, buildSpa } from "./lib/spa-build.ts";

buildSpa({ app: "ops", label: "the ops console", headers: headersFile(OPS_CONSOLE_POLICY) }, buildOptions("build-ops"));
