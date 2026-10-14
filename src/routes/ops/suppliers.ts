// Suppliers, behind Access (docs/decisions/0165-suppliers.md).
//
// Admin's to keep. Every write answers the whole of GET's answer, so the screen follows without reading again.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  allSuppliers,
  addSupplier,
  changeSupplier,
  retireSupplier,
  setSupplierItem,
} from "../../domain/purchasing/suppliers.ts";
import { written } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { COUNTRY, CURRENCY, GSTIN, SUPPLIER_BOUNDS } from "../../policy/suppliers.ts";

const Words = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);

const Days = (max: number) => z.number().int().min(0).max(max);

const SupplierFieldsSchema = z
  .object({
    name: Words(80),
    gstin: z.string().regex(GSTIN).nullable().openapi({ description: "India's GST number; null for none." }),
    country: z.string().regex(COUNTRY).openapi({ description: "ISO 3166 alpha-2, as IN." }),
    currency: z.string().regex(CURRENCY).openapi({ description: "ISO 4217, as INR: the one its invoices are in." }),
    contact_name: Words(80).nullable(),
    contact_phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/)
      .nullable(),
    contact_email: z.email().max(120).nullable(),
    payment_terms_days: Days(SUPPLIER_BOUNDS.paymentTermsDays),
    warranty_days: Days(SUPPLIER_BOUNDS.warrantyDays).openapi({
      description: "How long after a piece is fitted the supplier takes it back if it fails; nought for none.",
    }),
  })
  .strict();

const ItemSchema = z
  .object({
    consumable_code: z.string().min(1).max(64),
    their_code: Words(40).nullable(),
    unit_price: z.number().int().min(0).max(SUPPLIER_BOUNDS.unitPrice).openapi({
      description: "One unit's price in the supplier's currency, in its smallest unit: paise for rupees.",
    }),
    pack_size: z.number().int().min(1).max(SUPPLIER_BOUNDS.packSize),
    minimum_order: z.number().int().min(1).max(SUPPLIER_BOUNDS.minimumOrder),
    lead_time_days: Days(SUPPLIER_BOUNDS.leadTimeDays).openapi({ description: "As the supplier promises." }),
  })
  .strict();

const Text = z.string();
const MaybeText = z.union([z.string(), z.null()]);

const SuppliersSchema = z
  .object({
    suppliers: z.array(
      z
        .object({
          id: Text,
          name: Text,
          gstin: MaybeText,
          country: Text,
          currency: Text,
          contact_name: MaybeText,
          contact_phone: MaybeText,
          contact_email: MaybeText,
          payment_terms_days: z.number().int(),
          warranty_days: z.number().int(),
          retired_at: z.union([z.iso.datetime(), z.null()]),
          items: z.array(
            z
              .object({
                consumable_code: Text,
                their_code: MaybeText,
                unit_price: z.number().int().openapi({ description: "In the supplier's currency, its smallest unit." }),
                pack_size: z.number().int(),
                minimum_order: z.number().int(),
                lead_time_days: z.number().int(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    consumables: z
      .array(z.object({ code: z.string(), name: z.string(), unit: z.string() }).strict())
      .openapi({ description: "Every stock code, by name, for a supplier's items to name." }),
  })
  .strict()
  .openapi("Suppliers");

const SUPPLIERS = { description: "Every supplier", ...json(SuppliersSchema) };
const supplierPath = { params: z.object({ id: z.string().min(1).max(64) }) };
const REFUSED = errorResponse(
  "invalid_request: fields names name for one another supplier has, id for no such supplier, or consumable_code for none",
);
const ADMIN = errorResponse("access_required");

const listRoute = opsRoute({
  method: "get",
  path: "/api/suppliers",
  summary: "Every supplier, by name, with what each supplies",
  responses: { 200: SUPPLIERS, 403: ADMIN },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/suppliers",
  summary: "A new supplier",
  request: { body: { required: true, ...json(SupplierFieldsSchema.openapi("SupplierFields")) } },
  responses: { 200: SUPPLIERS, 400: REFUSED, 403: ADMIN },
});

const changeRoute = opsRoute({
  method: "post",
  path: "/api/suppliers/{id}",
  summary: "A supplier's record changed",
  request: { ...supplierPath, body: { required: true, ...json(SupplierFieldsSchema) } },
  responses: { 200: SUPPLIERS, 400: REFUSED, 403: ADMIN },
});

const retirementRoute = (which: "retire" | "restore") =>
  opsRoute({
    method: "post",
    path: `/api/suppliers/{id}/${which}`,
    summary: which === "retire" ? "A supplier taken off new orders" : "A retired supplier put back",
    request: supplierPath,
    responses: { 200: SUPPLIERS, 403: ADMIN, 404: errorResponse("not_found: no such supplier") },
  });

const itemRoute = opsRoute({
  method: "post",
  path: "/api/suppliers/{id}/items",
  summary: "What a supplier supplies of one stock code, set afresh",
  request: { ...supplierPath, body: { required: true, ...json(ItemSchema.openapi("SupplierItem")) } },
  responses: { 200: SUPPLIERS, 400: REFUSED, 403: ADMIN },
});

const removeRoute = opsRoute({
  method: "post",
  path: "/api/suppliers/{id}/items/{code}/remove",
  summary: "A stock code taken off a supplier's list",
  request: { params: z.object({ id: z.string().min(1).max(64), code: z.string().min(1).max(64) }) },
  responses: { 200: SUPPLIERS, 400: REFUSED, 403: ADMIN },
});

async function suppliersAnswer(c: Context<AppEnv>) {
  const [suppliers, consumables] = await Promise.all([
    allSuppliers(c.env.DB),
    c.env.DB.prepare("SELECT code, name, unit FROM consumables ORDER BY name COLLATE NOCASE").all<{
      code: string;
      name: string;
      unit: string;
    }>(),
  ]);
  return {
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      gstin: supplier.gstin,
      country: supplier.country,
      currency: supplier.currency,
      contact_name: supplier.contactName,
      contact_phone: supplier.contactPhone,
      contact_email: supplier.contactEmail,
      payment_terms_days: supplier.paymentTermsDays,
      warranty_days: supplier.warrantyDays,
      retired_at: supplier.retiredAt,
      items: supplier.items.map((item) => ({
        consumable_code: item.code,
        their_code: item.theirCode,
        unit_price: item.unitPrice,
        pack_size: item.packSize,
        minimum_order: item.minimumOrder,
        lead_time_days: item.leadTimeDays,
      })),
    })),
    consumables: consumables.results,
  };
}

const fieldsOf = (body: z.infer<typeof SupplierFieldsSchema>) => ({
  name: body.name,
  gstin: body.gstin,
  country: body.country,
  currency: body.currency,
  contactName: body.contact_name,
  contactPhone: body.contact_phone,
  contactEmail: body.contact_email,
  paymentTermsDays: body.payment_terms_days,
  warrantyDays: body.warranty_days,
});

export function registerOpsSuppliers(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await suppliersAnswer(c), 200));

  app.openapi(addRoute, async (c) => {
    const added = await addSupplier(c.env.DB, fieldsOf(c.req.valid("json")), written(c));
    if (!added.ok) return refuse(c, "invalid_request", added.fields);
    return c.json(await suppliersAnswer(c), 200);
  });

  app.openapi(changeRoute, async (c) => {
    const changed = await changeSupplier(c.env.DB, c.req.valid("param").id, fieldsOf(c.req.valid("json")), written(c));
    if (!changed.ok) return refuse(c, "invalid_request", changed.fields);
    return c.json(await suppliersAnswer(c), 200);
  });

  for (const which of ["retire", "restore"] as const) {
    app.openapi(retirementRoute(which), async (c) => {
      const done = await retireSupplier(c.env.DB, c.req.valid("param").id, which === "retire", written(c));
      if (!done) return refuse(c, "not_found");
      return c.json(await suppliersAnswer(c), 200);
    });
  }

  app.openapi(itemRoute, async (c) => {
    const body = c.req.valid("json");
    const item = {
      theirCode: body.their_code,
      unitPrice: body.unit_price,
      packSize: body.pack_size,
      minimumOrder: body.minimum_order,
      leadTimeDays: body.lead_time_days,
    };
    const set = { supplierId: c.req.valid("param").id, code: body.consumable_code, item };
    const done = await setSupplierItem(c.env.DB, set, written(c));
    if (!done.ok) return refuse(c, "invalid_request", done.fields);
    return c.json(await suppliersAnswer(c), 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { id, code } = c.req.valid("param");
    const done = await setSupplierItem(c.env.DB, { supplierId: id, code, item: null }, written(c));
    if (!done.ok) return refuse(c, "invalid_request", done.fields);
    return c.json(await suppliersAnswer(c), 200);
  });
}
