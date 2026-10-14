// Prices' calls to mm-api: the services and every price each has had and is to have, a price set, corrected or taken
// back, a service's steps, and the standard costs. Each is the console's client's (../api.ts), one function a route, so
// a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import {
  client,
  type Kind,
  type PriceChange,
  type PriceCorrection,
  type PriceWithdrawal,
  type ServiceAdd,
} from "../api.ts";
import type { paths } from "../api-schema.ts";

export const pricesApi = {
  setStandardCost: (body: Sent<paths["/api/standard-costs"]["post"]>) => client.post("/api/standard-costs", { body }),
  standardCosts: () => client.get("/api/standard-costs"),
  /** A price from the day it applies. The book gains a row; nothing already invoiced moves. */
  setPrice: (price: PriceChange) => client.post("/api/prices", { body: price }),
  /** A price still to come, taken back. The route refuses the one in force and every spent one. */
  withdrawPrice: (row: PriceWithdrawal) => client.post("/api/prices/withdraw", { body: row }),
  /** A price still to come, taken back and set again, from its own day or another, in one go. */
  correctPrice: (correction: PriceCorrection) => client.post("/api/prices/correct", { body: correction }),
  /** Every service, offered or retired, with every price it has had and is to have, and the two late fees. */
  services: () => client.get("/api/services"),
  /** Added last in its kind; clients see it once it has a price. */
  addService: (service: ServiceAdd) => client.post("/api/services", { body: service }),
  /** Its code stays, and with it every price it has and every visit sold under them. */
  renameService: (kind: Kind, tier: string, name: string) =>
    client.post("/api/services/{kind}/{tier}/name", { path: { kind, tier }, body: { name } }),
  /** The line clients read under its name as they choose; an empty one clears it. */
  describeService: (kind: Kind, tier: string, description: string) =>
    client.post("/api/services/{kind}/{tier}/description", { path: { kind, tier }, body: { description } }),
  /** How long visits booked from now on are held and booked for. */
  setServiceLength: (kind: Kind, tier: string, minutes: number) =>
    client.post("/api/services/{kind}/{tier}/length", { path: { kind, tier }, body: { minutes } }),
  /** Every one of a kind's codes, once, first to last. */
  orderServices: (kind: Kind, tiers: readonly string[]) =>
    client.post("/api/services/{kind}/order", { path: { kind }, body: { tiers: [...tiers] } }),
  /** No longer offered from a day, today or later. The route keeps every kind one service to book. */
  retireService: (kind: Kind, tier: string, from: string) =>
    client.post("/api/services/{kind}/{tier}/retire", { path: { kind, tier }, body: { from } }),
  restoreService: (kind: Kind, tier: string) =>
    client.post("/api/services/{kind}/{tier}/restore", { path: { kind, tier } }),
};
