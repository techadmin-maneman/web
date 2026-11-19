// Builds the technician app for one environment into apps/tech/dist/<environment>,
// with its _headers (docs/decisions/0026-hosts-and-surfaces.md). Production is
// refused while its copy is marked PLACEHOLDER, and a build fails whose first
// screen loads over 200 KB of gzipped JavaScript, or whose service worker keeps
// over 260 KB (scripts/lib/spa-build.ts, docs/decisions/0284-the-first-screen-and-the-precache.md).
//
//   npm run build:tech -- --env staging

import { headersFile } from "@maneman/web-kit/headers";
import { TECHNICIAN_APP_POLICY } from "../../apps/tech/headers.ts";
import { buildOptions, buildSpa } from "../lib/spa-build.ts";

buildSpa(
  { app: "tech", label: "the technician app", headers: headersFile(TECHNICIAN_APP_POLICY) },
  buildOptions("build-tech"),
);
