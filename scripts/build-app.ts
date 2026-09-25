// Builds the client app for one environment into apps/app/dist/<environment>,
// with its _headers (docs/decisions/0043-client-app.md). Production is refused
// while its copy is marked PLACEHOLDER, and any build whose JavaScript is over
// the prompt's 150 KB gzipped fails (scripts/lib/spa-build.ts).
//
//   npm run build:app -- --env staging

import { headersFile } from "@maneman/web-kit/headers";
import { CLIENT_APP_POLICY } from "../apps/app/headers.ts";
import { buildOptions, buildSpa } from "./lib/spa-build.ts";

buildSpa({ app: "app", label: "the client app", headers: headersFile(CLIENT_APP_POLICY) }, buildOptions("build-app"));
