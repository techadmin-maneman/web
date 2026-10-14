// Items' calls to mm-api: the items we stock, each added, changed, retired, restored or deleted, what each service is
// expected to use, and a hair system added. Each is the console's client's (../api.ts), one function a route, so a call
// is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client, type ConsumableChange, type NewConsumable, type ServiceUsage } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const itemsApi = {
  addHairSystem: (body: Sent<paths["/api/hair-systems"]["post"]>) => client.post("/api/hair-systems", { body }),
  /** Every consumable, and each service's expected use. */
  consumables: () => client.get("/api/consumables"),
  addConsumable: (added: NewConsumable) => client.post("/api/consumables", { body: added }),
  /** Only the fields sent change; a null level clears it. */
  changeConsumable: (code: string, change: ConsumableChange) =>
    client.post("/api/consumables/{code}", { path: { code }, body: change }),
  /** No longer offered from the day given, today or later. Nothing already recorded moves. */
  retireConsumable: (code: string, from: string) =>
    client.post("/api/consumables/{code}/retire", { path: { code }, body: { from } }),
  restoreConsumable: (code: string) => client.post("/api/consumables/{code}/restore", { path: { code } }),
  /** Refused, as in_use, once stock of it has moved or a job used it. */
  deleteConsumable: (code: string) => client.post("/api/consumables/{code}/delete", { path: { code } }),
  /** A service's whole list: a consumable left out is expected no more. */
  setServiceUsage: (usage: ServiceUsage) => client.post("/api/service-usage", { body: usage }),
};
