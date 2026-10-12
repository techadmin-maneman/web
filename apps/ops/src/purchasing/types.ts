// What the Purchasing page reads, as GET /api/purchase-orders answers it (docs/decisions/0166-purchase-orders.md).

import type { paths } from "../api-schema.ts";

export type Orders = paths["/api/purchase-orders"]["get"]["responses"][200]["content"]["application/json"];
export type Order = Orders["orders"][number];
