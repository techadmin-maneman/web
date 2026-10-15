// A refusal from the API in a screen's words (packages/web-kit/refusal.ts): by its code, or, for an invalid_request,
// by the box it names, said on that box's Field, so the box is marked invalid and described by them; the form says
// only what no box does.

import { describe, expect, it } from "vitest";
import { boxError, errorText, formError } from "../../../packages/web-kit/refusal.ts";

const errors = {
  name: "Give the item a name.",
  items: "Check each line.",
  quantity: "Give a whole number.",
  not_permitted: "You can’t change this.",
  unknown: "That didn’t go through.",
};

describe("a refusal's words", () => {
  it("are its code's, or the box an invalid_request names, then that box's list, then the catch-all", () => {
    expect(errorText(errors, { code: "not_permitted" })).toBe(errors.not_permitted);
    expect(errorText(errors, { code: "invalid_request", fields: ["name"] })).toBe(errors.name);
    expect(errorText(errors, { code: "invalid_request", fields: ["items.2.quantity"] })).toBe(errors.quantity);
    expect(errorText(errors, { code: "invalid_request", fields: ["items.2.colour"] })).toBe(errors.items);
    expect(errorText(errors, { code: "clash" })).toBe(errors.unknown);
  });
});

describe("a refused box", () => {
  const refused = { code: "invalid_request", fields: ["items.1.quantity", "name"] };

  it("says its own words on its Field, whether named by itself or as a line of its list", () => {
    expect(boxError(errors, refused, "name")).toBe(errors.name);
    expect(boxError(errors, refused, "quantity")).toBe(errors.quantity);
    expect(boxError(errors, refused, "items")).toBe(errors.quantity);
  });

  it("says nothing where the refusal named another box, was no invalid_request, or there was none", () => {
    expect(boxError(errors, refused, "supplier")).toBeNull();
    expect(boxError(errors, { code: "not_permitted" }, "name")).toBeNull();
    expect(boxError(errors, null, "name")).toBeNull();
  });
});

describe("the form's own refusal", () => {
  it("is everything but what the form's boxes say", () => {
    const boxes = ["name", "quantity"];
    expect(formError(errors, { code: "invalid_request", fields: ["name"] }, boxes)).toBeNull();
    expect(formError(errors, { code: "invalid_request", fields: ["supplier"] }, boxes)).toBe(errors.unknown);
    expect(formError(errors, { code: "not_permitted" }, boxes)).toBe(errors.not_permitted);
    expect(formError(errors, null, boxes)).toBeNull();
  });
});
