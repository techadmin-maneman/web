// Grievances' calls to mm-api: the grievances, and each answered. Each is the console's client's (../api.ts), one
// function a route, so a call is found, and changed, in one place.

import { client } from "../api.ts";

export const grievancesApi = {
  /** The grievances nobody has answered yet, oldest first. */
  grievances: () => client.get("/api/grievances"),
  /** Ops' answer, which closes the grievance. Nothing sends it to the client; ops do that themselves. */
  resolveGrievance: (id: string, response: string) =>
    client.post("/api/grievances/{id}/resolve", { path: { id }, body: { response } }),
};
