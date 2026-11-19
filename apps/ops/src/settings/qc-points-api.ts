// The checks on a hair system that arrives, at Settings › Purchasing: the console's client's (../api.ts) calls, one
// function a route.

import { client } from "../api.ts";

export const qcPointsApi = {
  points: () => client.get("/api/qc-points"),
  add: (name: string) => client.post("/api/qc-points", { body: { name } }),
  /** A check renamed, or switched on or off. */
  change: (id: string, change: { name: string; checked: boolean }) =>
    client.patch("/api/qc-points/{id}", { path: { id }, body: change }),
  /** A check no claim names, deleted. */
  delete: (id: string) => client.post("/api/qc-points/{id}/delete", { path: { id } }),
};
