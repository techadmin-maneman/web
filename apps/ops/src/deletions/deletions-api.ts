// Deletion requests' calls to mm-api: the requests, and each decided. Each is the console's client's (../api.ts), one
// function a route, so a call is found, and changed, in one place.

import { client } from "../api.ts";

export const deletionsApi = {
  deletionRequests: () => client.get("/api/deletion-requests"),
  /**
   * "delete" erases the client at once and cannot be undone; "reject" needs a
   * reason. The route wants the field either way, so a deletion sends it as null.
   */
  decideDeletion: (id: string, decision: "delete" | "reject", reason: string | null) =>
    client.post("/api/deletion-requests/{id}/decision", { path: { id }, body: { decision, reason } }),
};
