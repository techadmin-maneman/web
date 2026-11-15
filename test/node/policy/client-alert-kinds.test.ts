// The messages that have an alert beside them in the client's app (docs/decisions/0255-client-alerts-and-push.md):
// every kind but WhatsApp's own, the same in the rule and in the trigger that writes them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS } from "../../../src/config/message-kinds.ts";
import { WHATSAPP_ONLY } from "../../../src/policy/client-alerts.ts";

describe("the client's alerts beside messages", () => {
  it("leave out, in migration 0211's trigger, exactly the kinds the rule calls WhatsApp's own", () => {
    const sql = readFileSync("migrations/0211_client_app_alerts.sql", "utf8");
    const trigger = /client_app_alerts_beside_messages[\s\S]*?NOT IN \(([\s\S]*?)\)/.exec(sql)?.[1] ?? "";
    const leftOut = [...trigger.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    expect(leftOut.sort()).toEqual([...WHATSAPP_ONLY].sort());
  });

  it("leave out only kinds there are", () => {
    expect(WHATSAPP_ONLY.filter((kind) => !(MESSAGE_KINDS as readonly string[]).includes(kind))).toEqual([]);
  });
});
