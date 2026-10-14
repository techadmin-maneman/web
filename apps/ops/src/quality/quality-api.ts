// Quality's calls to mm-api: the recalls, failure rates and the value at risk. Each is the console's client's
// (../api.ts), one function a route, so a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const qualityApi = {
  closeRecall: (id: string) => client.post("/api/recalls/{id}/close", { path: { id } }),
  expiryRisk: () => client.get("/api/stock/expiry-risk"),
  failures: () => client.get("/api/quality/failures"),
  raiseRecall: (body: Sent<paths["/api/recalls"]["post"]>) => client.post("/api/recalls", { body }),
  recall: (id: string) => client.get("/api/recalls/{id}", { path: { id } }),
  recalls: () => client.get("/api/recalls"),
};
