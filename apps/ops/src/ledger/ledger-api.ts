// The Payments ledger's call, made with the console's client (../api.ts).

import type { Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type Ledger = Success<paths["/api/payments/ledger"]["get"]>;

export const ledgerApi = {
  ledger: (from: string, to: string, city: string | null) =>
    client.get("/api/payments/ledger", { query: { from, to, ...(city === null ? {} : { city }) } }),
  /** The day's money: collected, and refunds still on their way back. */
  day: (date: string, city: string | null) =>
    client.get("/api/payments", { query: { date, ...(city === null ? {} : { city }) } }),
};
