// Builds the client app for one environment into apps/app/dist/<environment>,
// with its _headers (docs/decisions/0043-client-app.md). Production is refused
// while its copy is marked PLACEHOLDER, and a build fails whose first screen,
// the page and Home, loads over 200 KB of gzipped JavaScript, or whose service
// worker keeps over 260 KB (scripts/lib/spa-build.ts, docs/decisions/0284-the-first-screen-and-the-precache.md).
//
//   npm run build:app -- --env staging

import { headersFile } from "@maneman/web-kit/headers";
import { CLIENT_APP_POLICY } from "../../apps/app/headers.ts";
import { buildOptions, buildSpa } from "../lib/spa-build.ts";

buildSpa(
  { app: "app", label: "the client app", headers: headersFile(CLIENT_APP_POLICY), landing: "HomeScreen" },
  buildOptions("build-app"),
);
