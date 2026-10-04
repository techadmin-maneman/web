// Every alert the code raises has its row in the runbook's table of alerts (docs/runbook.md, "What each alert
// means"), so the person on call can look up what it means and how it closes (scripts/lib/alert-keys.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentedKeys, raisedKeys } from "../../scripts/lib/alert-keys.ts";

describe("the runbook's table of alerts", () => {
  it("names every key the code raises an alert under", () => {
    const documented = documentedKeys(readFileSync("docs/runbook.md", "utf8"));
    // A key made of a kind, as `books_${kind}_failed`, is named in the table by each kind it takes.
    const missing = raisedKeys().filter((key) => !documented.some((each) => each === key || each.startsWith(key)));
    expect(missing).toEqual([]);
  });

  it("finds the keys a helper or a constant gives, not only those written in place", () => {
    const raised = raisedKeys();
    expect(raised).toEqual(expect.arrayContaining(["payment_link", "payment_link_failed", "cron_job", "r2_share"]));
  });
});
