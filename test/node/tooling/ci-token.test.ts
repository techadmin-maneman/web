// What scripts/release/verify-ci-token.ts says about the other environment's database.
// D1 Edit is account-wide (docs/decisions/0008, #3), so a CI token can write
// the other environment's database, not only read it; the check proves which
// with a write that changes nothing.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NO_OP_WRITE, otherDatabaseAccess } from "../../../scripts/lib/ci-token.ts";

describe("the write that proves the permission", () => {
  it("changes nothing in the identity row it names", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_deployment_identity.sql", "utf8"));
    db.exec("INSERT INTO deployment_identity (id, database_name) VALUES (1, 'maneman-prod')");
    expect(db.prepare(NO_OP_WRITE).run().changes).toBe(0);
    expect(db.prepare("SELECT database_name FROM deployment_identity").all()).toEqual([
      { database_name: "maneman-prod" },
    ]);
  });
});

describe("the report on the other environment's database", () => {
  it("says the token can write it where it can, and where that was accepted", () => {
    expect(otherDatabaseAccess({ read: true, write: true }, "maneman-prod")).toBe(
      "can read and WRITE maneman-prod: D1 Edit is account-wide (accepted in docs/decisions/0008, #3)",
    );
  });

  it("says so when the token can only read it, or not reach it at all", () => {
    expect(otherDatabaseAccess({ read: true, write: false }, "maneman-prod")).toBe(
      "can read maneman-prod, not write it",
    );
    expect(otherDatabaseAccess({ read: false, write: false }, "maneman-prod")).toBe(
      "cannot reach maneman-prod (tighter than required)",
    );
  });
});
