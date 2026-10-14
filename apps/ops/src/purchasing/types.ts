// What the Purchasing page reads, as GET /api/purchase-orders answers it (docs/decisions/0166-purchase-orders.md).

import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";

export type Orders = Success<paths["/api/purchase-orders"]["get"]>;
export type Order = Orders["orders"][number];

// Claims on suppliers and the returned pieces to settle, as GET /api/supplier-claims answers them
// (docs/decisions/0169-supplier-claims.md).
export type SupplierClaims = Success<paths["/api/supplier-claims"]["get"]>;
export type Claim = SupplierClaims["claims"][number];
export type ReturnedPiece = SupplierClaims["returns"][number];
