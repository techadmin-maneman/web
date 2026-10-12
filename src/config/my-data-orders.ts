// The readable copy's part for a client's custom orders (./my-data.ts; docs/decisions/0174-custom-orders.md).

import { day, money, text, time, words, type Part } from "./my-data-fields.ts";

export const CUSTOM_ORDERS_PART: Part = {
  title: "Hair systems made for you",
  fields: {
    number: text("Order"),
    product: words("Hair system"),
    base_width_in: text("Base width, inches"),
    base_length_in: text("Base length, inches"),
    colour: text("Colour"),
    grey_percent: text("Grey, %"),
    density_percent: text("Density, %"),
    wave: words("Wave"),
    amount: money("Price"),
    promised_on: day("Promised by"),
    state: words("Where it stands"),
    short_url: text("Payment link"),
    link_sent_at: time("Link sent"),
    paid_at: time("Paid"),
    refund_reason: words("Refunded because"),
    refunded_at: time("Refunded"),
    raised_at: time("Ordered"),
    updated_at: time("Last changed"),
  },
};
