// The alerts' words (apps/app/src/content/alerts.ts), held to the API's published contract (docs/openapi-client.json): a
// title, a line and a page for every kind of alert the inbox can hold, so a kind added to the API is worded here too.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALERTS, alertWords } from "../../../../apps/app/src/content/alerts.ts";

const contract = JSON.parse(readFileSync("docs/openapi-client.json", "utf8")) as {
  components: { schemas: { ClientAlert: { properties: { kind: { enum: string[] } } } } };
};
const KINDS = contract.components.schemas.ClientAlert.properties.kind.enum;

describe("the alerts' words", () => {
  it("word every kind the inbox can hold, a technician's word by its own kind", () => {
    expect(KINDS.filter((kind) => kind !== "technician_update" && ALERTS[kind] === undefined)).toEqual([]);
    expect(Object.keys(ALERTS).filter((kind) => !KINDS.includes(kind))).toEqual([]);
  });

  it("open the visit an alert is about, else the page its kind belongs to", () => {
    const alert = { id: "a", kind: "payment_receipt", visit_id: null, update: null, at: "", read: false };
    expect(alertWords(alert).to).toBe("/profile/payments");
    expect(alertWords({ ...alert, visit_id: "v1" }).to).toBe("/visits/v1");
  });

  it("say when the technician now arrives, from the minutes they gave", () => {
    const update = { kind: "running_late", minutes: 15 } as const;
    const alert = { id: "a", kind: "technician_update", visit_id: "v1", update, at: "", read: false };
    expect(alertWords(alert)).toMatchObject({ title: "Your technician is running late", to: "/visits/v1" });
    expect(alertWords(alert).line).toContain("15 minutes");
  });
});
