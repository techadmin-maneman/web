// Builds the technician app for one environment into apps/tech/dist/<environment>,
// with its _headers (docs/decisions/0026-hosts-and-surfaces.md). Production is
// refused while its copy is marked PLACEHOLDER, and any build whose JavaScript
// is over the prompt's 150 KB gzipped fails: the service worker's included,
// which a first load fetches too (scripts/lib/spa-build.ts).
//
//   npm run build:tech -- --env staging

import { headersFile } from "@maneman/web-kit/headers";
import { TECHNICIAN_APP_POLICY } from "../apps/tech/headers.ts";
import { buildOptions, buildSpa } from "./lib/spa-build.ts";

buildSpa(
  { app: "tech", label: "the technician app", headers: headersFile(TECHNICIAN_APP_POLICY) },
  buildOptions("build-tech"),
);
