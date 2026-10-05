// .dev.vars kept up with .dev.vars.example (scripts/dev/ensure-dev-vars.ts), without ever overwriting a value.

import { describe, expect, it } from "vitest";
import { updatedDevVars } from "../../../scripts/lib/dev-vars.ts";

describe("updatedDevVars", () => {
  it("adds the keys the example has gained since, and keeps every value already there", () => {
    const update = updatedDevVars("A=mine\n", "A=example\nB=new\n");
    expect(update).toEqual({ text: "A=mine\nB=new\n", added: ["B"], filled: [] });
  });

  // A .dev.vars made before the webhook had a local secret kept it empty, and the webhook answered 404.
  it("fills a key left empty that the example now gives a value, and no other", () => {
    const update = updatedDevVars("A=\nB=\nC=set\n", "A=placeholder\nB=\nC=other\n");
    expect(update).toEqual({ text: "A=placeholder\nB=\nC=set\n", added: [], filled: ["A"] });
  });

  it("changes nothing when it is up to date, and keeps a file without a final newline whole", () => {
    expect(updatedDevVars("A=1\nB=2\n", "A=\nB=\n")).toEqual({ text: "A=1\nB=2\n", added: [], filled: [] });
    expect(updatedDevVars("A=1", "A=\nB=2\n").text).toBe("A=1\nB=2\n");
  });
});
