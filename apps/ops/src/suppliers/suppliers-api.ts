// Suppliers' calls to mm-api: the suppliers, each added, changed, retired or restored, and what each supplies. Each is
// the console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import type { Sent, Success } from "@maneman/web-kit/api";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";

export type Suppliers = Success<paths["/api/suppliers"]["get"]>;
export type Supplier = Suppliers["suppliers"][number];
export type SupplierFields = Sent<paths["/api/suppliers"]["post"]>;
export type SupplierItem = Sent<paths["/api/suppliers/{id}/items"]["post"]>;

export const suppliersApi = {
  addSupplier: (body: SupplierFields) => client.post("/api/suppliers", { body }),
  changeSupplier: (id: string, body: SupplierFields) => client.post("/api/suppliers/{id}", { path: { id }, body }),
  removeSupplierItem: (id: string, code: string) =>
    client.post("/api/suppliers/{id}/items/{code}/remove", { path: { id, code } }),
  setSupplierItem: (id: string, body: SupplierItem) => client.post("/api/suppliers/{id}/items", { path: { id }, body }),
  suppliers: () => client.get("/api/suppliers"),
  retireSupplier: (id: string) => client.post("/api/suppliers/{id}/retire", { path: { id } }),
  restoreSupplier: (id: string) => client.post("/api/suppliers/{id}/restore", { path: { id } }),
};
