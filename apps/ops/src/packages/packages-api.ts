// Packages' calls to mm-api: every package with its parts, one added, changed, put in order, retired, sold again or
// deleted, and a hair system added. Each is the console's client's (../api.ts), one function a route, so a call is
// found, and changed, in one place. A price is set, corrected or withdrawn by Prices' own calls (../prices/prices-api.ts).

import type { Sent, Success as Body } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type Packages = Body<paths["/api/packages"]["get"]>;
export type Package = Packages["packages"][number];
export type PackageHairSystem = Package["hair_systems"][number];
export type PackageChange = Sent<paths["/api/packages/{code}"]["patch"]>;
export type ProductCost = Body<paths["/api/standard-costs"]["get"]>["products"][number];

export const packagesApi = {
  packages: () => client.get("/api/packages"),
  /** Added last; clients see it once a hair system and its service visit have prices. */
  add: (name: string) => client.post("/api/packages", { body: { name } }),
  /** Only the boxes sent change. */
  change: (code: string, change: PackageChange) =>
    client.patch("/api/packages/{code}", { path: { code }, body: change }),
  /** Every package's code, once, first to last. */
  order: (codes: readonly string[]) => client.post("/api/packages/order", { body: { codes: [...codes] } }),
  /** No longer sold from a day, today or later; its clients keep their visits. */
  retire: (code: string, from: string) =>
    client.post("/api/packages/{code}/retire", { path: { code }, body: { from } }),
  restore: (code: string) => client.post("/api/packages/{code}/restore", { path: { code } }),
  /** Refused, as in_use, once anything was sold under it. */
  remove: (code: string) => client.delete("/api/packages/{code}", { path: { code } }),
  addHairSystem: (body: Sent<paths["/api/hair-systems"]["post"]>) => client.post("/api/hair-systems", { body }),
};
