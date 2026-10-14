// Counts' calls to mm-api: the count tasks, each count, recount and sign-off, and each item's count class. Each is the
// console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const countsApi = {
  countTask: (id: string) => client.get("/api/count-tasks/{id}", { path: { id } }),
  countTasks: () => client.get("/api/count-tasks"),
  differences: (id: string) => client.get("/api/count-tasks/{id}/differences", { path: { id } }),
  setCountClass: (code: string, body: Sent<paths["/api/consumables/{code}/count-class"]["post"]>) =>
    client.post("/api/consumables/{code}/count-class", { path: { code }, body }),
  startCount: (body: Sent<paths["/api/count-tasks"]["post"]>) => client.post("/api/count-tasks", { body }),
  recordCounts: (id: string, body: Sent<paths["/api/count-tasks/{id}/counts"]["post"]>) =>
    client.post("/api/count-tasks/{id}/counts", { path: { id }, body }),
  askRecount: (id: string, body: Sent<paths["/api/count-tasks/{id}/recounts"]["post"]>) =>
    client.post("/api/count-tasks/{id}/recounts", { path: { id }, body }),
  signOff: (id: string, note: string) =>
    client.post("/api/count-tasks/{id}/sign-off", { path: { id }, body: { note } }),
};
