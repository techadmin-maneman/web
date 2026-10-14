// The supply plan's calls to mm-api: the plan and each line decided, its forecast and how well the last one did, and
// the events that move demand. Each is the console's client's (../api.ts), one function a route, so a call is found,
// and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const supplyPlanApi = {
  accuracy: (query: NonNullable<paths["/api/stock/forecast-accuracy"]["get"]["parameters"]["query"]>) =>
    client.get("/api/stock/forecast-accuracy", { query }),
  addDemandEvent: (body: Sent<paths["/api/demand-events"]["post"]>) => client.post("/api/demand-events", { body }),
  demandEvents: () => client.get("/api/demand-events"),
  draftPlan: () => client.post("/api/supply-plan/draft"),
  forecast: (query: NonNullable<paths["/api/stock/forecast"]["get"]["parameters"]["query"]>) =>
    client.get("/api/stock/forecast", { query }),
  plan: () => client.get("/api/supply-plan"),
  removeDemandEvent: (id: string) => client.post("/api/demand-events/{id}/remove", { path: { id } }),
  rejectLine: (id: string, reason: string) =>
    client.post("/api/supply-plan/lines/{id}/reject", { path: { id }, body: { reason } }),
  approveLine: (id: string, quantity: number) =>
    client.post("/api/supply-plan/lines/{id}/approve", { path: { id }, body: { quantity } }),
};
