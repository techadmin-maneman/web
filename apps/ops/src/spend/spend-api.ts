// The Spend page's calls (docs/decisions/0150-spend.md), made with the console's client (../api.ts).

import type { Sent, Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type SpendList = Success<paths["/api/spend"]["get"]>;
export type SpendEntry = SpendList["entries"][number];
export type SpendNew = Sent<paths["/api/spend"]["post"]>;
export type SpendChannel = SpendEntry["channel"];

export const spendApi = {
  list: () => client.get("/api/spend"),
  add: (entry: SpendNew) => client.post("/api/spend", { body: entry }),
  remove: (id: string) => client.post("/api/spend/{id}/remove", { path: { id } }),
};
