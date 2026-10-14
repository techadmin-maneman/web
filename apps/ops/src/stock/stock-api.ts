// Stock's calls to mm-api: movements recorded, the places, the labelled units and lots, transfers received or sent
// back, and the demand on stock. Each is the console's client's (../api.ts), one function a route, so a call is found,
// and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import {
  client,
  type StockPlaceAdd,
  type StockPlaceChange,
  type StockCount,
  type StockDelivery,
  type StockTransfer,
  type StockWriteOff,
} from "../api.ts";
import type { paths } from "../api-schema.ts";

export const stockApi = {
  addUnits: (body: Sent<paths["/api/stock/units"]["post"]>) => client.post("/api/stock/units", { body }),
  demand: () => client.get("/api/stock/demand"),
  labelLot: (id: string) => client.post("/api/stock/lots/{id}/label", { path: { id } }),
  receiveTransfer: (id: string, body: Sent<paths["/api/stock/transfers/{id}/receive"]["post"]>) =>
    client.post("/api/stock/transfers/{id}/receive", { path: { id }, body }),
  sendBack: (id: string) => client.post("/api/stock/transfers/{id}/send-back", { path: { id } }),
  unit: (code: string) => client.get("/api/stock/units/{code}", { path: { code } }),
  units: (query: NonNullable<paths["/api/stock/units"]["get"]["parameters"]["query"]>) =>
    client.get("/api/stock/units", { query }),
  recordDelivery: (delivery: StockDelivery) => client.post("/api/stock/deliveries", { body: delivery }),
  recordTransfer: (moved: StockTransfer) => client.post("/api/stock/transfers", { body: moved }),
  /** The ledger takes the difference from what it held. */
  recordCount: (counted: StockCount) => client.post("/api/stock/counts", { body: counted }),
  recordWriteOff: (lost: StockWriteOff) => client.post("/api/stock/write-offs", { body: lost }),
  addStockPlace: (place: StockPlaceAdd) => client.post("/api/stock/places", { body: place }),
  changeStockPlace: (id: string, change: StockPlaceChange) =>
    client.post("/api/stock/places/{id}", { path: { id }, body: change }),
};
