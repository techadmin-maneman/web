// How a script's read reaches a database through wrangler (scripts/lib/d1.ts).

import { describe, expect, it } from "vitest";
import { queryArguments } from "../../../scripts/lib/d1.ts";

describe("a script's read", () => {
  it("goes to a deployed database whole, by --command, never as a file its import would answer with counts", () => {
    const sql = "SELECT id\n  FROM people\n  WHERE books_customer_id IS NOT NULL";
    const args = queryArguments("staging", sql);

    expect(args.slice(args.indexOf("--command"), args.indexOf("--command") + 2)).toEqual(["--command", sql]);
    expect(args).toContain("--remote");
    expect(args).toContain("maneman-staging");
    expect(args).not.toContain("--file");
  });

  it("goes to the local database by its binding", () => {
    expect(queryArguments("local", "SELECT 1")).toEqual(
      expect.arrayContaining(["DB", "--local", "--json", "--command", "SELECT 1"]),
    );
  });
});
