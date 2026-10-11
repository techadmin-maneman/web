// The address's fields every form draws (packages/web-kit/address.ts), held to the API's own shape
// (src/routes/schemas/address.ts): a part the form lets through is one the API takes, at the length it takes.

import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ADDRESS_FIELDS, missingParts } from "../../../packages/web-kit/address.ts";
import { AddressSchema } from "../../../src/routes/schemas/address.ts";

/** A part's longest, as the API checks it; null where it checks a pattern instead. */
function longest(part: keyof typeof AddressSchema.shape): number | null {
  let schema: unknown = AddressSchema.shape[part];
  while (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) schema = schema.unwrap();
  return schema instanceof z.ZodString ? schema.maxLength : null;
}

describe("the address's fields", () => {
  it("hold each part to the API's longest", () => {
    for (const field of ADDRESS_FIELDS) {
      expect({ part: field.part, maxLength: field.maxLength ?? null }).toEqual({
        part: field.part,
        maxLength: longest(field.part),
      });
    }
  });

  it("mark as required exactly the parts an address is not one without", () => {
    const required = ADDRESS_FIELDS.filter((field) => field.required === true).map((field) => field.part);
    const empty = { line1: "", locality: "", city: "", pincode: "" };
    expect(required).toEqual(missingParts(empty));
  });
});
