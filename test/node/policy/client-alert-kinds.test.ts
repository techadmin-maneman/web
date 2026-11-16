// The messages that have an alert beside them in the client's app (docs/decisions/0255-client-alerts-and-push.md):
// every kind but WhatsApp's own, the same in the rule and in the trigger that writes them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS } from "../../../src/config/message-kinds.ts";
import { WHATSAPP_ONLY } from "../../../src/policy/client-alerts.ts";

describe("the client's alerts beside messages", () => {
  it("leave out, in each of migration 0211's triggers on messages, exactly the kinds the rule calls WhatsApp's own", () => {
    const sql = readFileSync("migrations/0211_client_app_alerts.sql", "utf8");
    const lists = [...sql.matchAll(/NEW\.kind NOT IN \(([\s\S]*?)\)/g)].map((match) =>
      [...(match[1] ?? "").matchAll(/'(\w+)'/g)].map((kind) => kind[1]).sort(),
    );
    expect(lists).toEqual([[...WHATSAPP_ONLY].sort(), [...WHATSAPP_ONLY].sort()]);
  });

  it("leave out only kinds there are", () => {
    expect(WHATSAPP_ONLY.filter((kind) => !(MESSAGE_KINDS as readonly string[]).includes(kind))).toEqual([]);
  });
});
