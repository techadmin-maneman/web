// Targets' calls to mm-api: each month's targets, set and taken off. Each is the console's client's (../api.ts), one
// function a route, so a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const targetsApi = {
  removeTarget: (body: Sent<paths["/api/targets/remove"]["post"]>) => client.post("/api/targets/remove", { body }),
  setTarget: (body: Sent<paths["/api/targets"]["post"]>) => client.post("/api/targets", { body }),
  targets: (query: NonNullable<paths["/api/targets"]["get"]["parameters"]["query"]>) =>
    client.get("/api/targets", { query }),
};
