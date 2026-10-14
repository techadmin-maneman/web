// Discount codes' calls to mm-api: the codes and what they came to, codes made, and one switched off or deleted. Each
// is the console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type DiscountCodesNew } from "../api.ts";

export const discountCodesApi = {
  /** The latest codes made, or the one with this text, each with its uses and what it has given. */
  discountCodes: (code: string | null = null) =>
    client.get("/api/discount-codes", code === null ? {} : { query: { code } }),
  /** One code typed, or one or more generated; more than one generated are single-use. */
  makeDiscountCodes: (codes: DiscountCodesNew) => client.post("/api/discount-codes", { body: codes }),
  /** No booking takes it from now on; the bookings that carry it keep it. */
  switchOffDiscountCode: (id: string) => client.post("/api/discount-codes/{id}/off", { path: { id } }),
  /** Refused, as in_use, once a booking has taken it. */
  deleteDiscountCode: (id: string) => client.post("/api/discount-codes/{id}/delete", { path: { id } }),
};
