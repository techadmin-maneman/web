// Number changes' calls to mm-api: the changes waiting, and each decided. Each is the console's client's (../api.ts),
// one function a route, so a call is found, and changed, in one place.

import { client } from "../api.ts";

export const numberChangesApi = {
  numberChanges: () => client.get("/api/number-changes"),
  /** Confirming moves the client to the new number; rejecting needs a reason. */
  decideNumberChange: (id: string, decision: "confirm" | "reject", reason: string | null) =>
    client.post("/api/number-changes/{id}/decision", { path: { id }, body: { decision, reason } }),
};
