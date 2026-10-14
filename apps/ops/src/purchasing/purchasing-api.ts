// Purchasing's calls to mm-api: the purchase orders and their steps, receipts, the claims on suppliers and the pieces
// returned, each supplier's scorecard, and a photograph of stock. Each is the console's client's (../api.ts), one
// function a route, so a call is found, and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export const purchasingApi = {
  claimReturned: (id: string) => client.post("/api/returned-pieces/{id}/claim", { path: { id } }),
  claims: () => client.get("/api/supplier-claims"),
  closeOrder: (id: string) => client.post("/api/purchase-orders/{id}/close", { path: { id } }),
  decideClaim: (id: string, body: Sent<paths["/api/supplier-claims/{id}/decide"]["post"]>) =>
    client.post("/api/supplier-claims/{id}/decide", { path: { id }, body }),
  draftOrder: (body: Sent<paths["/api/purchase-orders"]["post"]>) => client.post("/api/purchase-orders", { body }),
  orders: () => client.get("/api/purchase-orders"),
  setLetterhead: (body: Sent<paths["/api/purchase-orders/letterhead"]["post"]>) =>
    client.post("/api/purchase-orders/letterhead", { body }),
  receive: (id: string, body: Sent<paths["/api/purchase-orders/{id}/receipts"]["post"]>) =>
    client.post("/api/purchase-orders/{id}/receipts", { path: { id }, body }),
  scorecard: () => client.get("/api/supplier-scorecard"),
  approveOrder: (id: string) => client.post("/api/purchase-orders/{id}/approve", { path: { id } }),
  sendOrder: (id: string) => client.post("/api/purchase-orders/{id}/send", { path: { id } }),
  cancelOrder: (id: string, reason: string) =>
    client.post("/api/purchase-orders/{id}/cancel", { path: { id }, body: { reason } }),
  withdrawClaim: (id: string, note: string) =>
    client.post("/api/supplier-claims/{id}/withdraw", { path: { id }, body: { note } }),
  sendClaim: (id: string, body: Sent<paths["/api/supplier-claims/{id}/send"]["post"]>) =>
    client.post("/api/supplier-claims/{id}/send", { path: { id }, body }),
  writeOffReturned: (id: string, body: Sent<paths["/api/returned-pieces/{id}/write-off"]["post"]>) =>
    client.post("/api/returned-pieces/{id}/write-off", { path: { id }, body }),
  /** A photograph of stock, as a small JPEG, stored for a write-off or a claim to name. */
  storePhoto: (photo: Blob) =>
    client.request<{ photo_id: string }>("POST", "/api/stock-photos", {
      body: photo,
      headers: { "Content-Type": "image/jpeg" },
    }),
};
