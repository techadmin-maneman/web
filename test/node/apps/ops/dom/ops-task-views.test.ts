// What Tasks is narrowed to (apps/ops/src/tasks/task-views.ts): every task, the person's own, nobody's or the
// overdue, each view counted over the kind and the client asked for, and a task taken here counted as theirs.

import { describe, expect, it } from "vitest";
import type { Task } from "../../../../../apps/ops/src/api.ts";
import { narrowed, NO_FILTER, type Row } from "../../../../../apps/ops/src/tasks/task-views.ts";

const NOW = new Date("2027-09-22T05:00:00.000Z");
const ME = "priya@maneman.in";

const task = (id: string, name: string, due: string): Task => ({
  id,
  person: { id: `p-${id}`, name, mobile: "+919812345678" },
  facts: { group: "address_to_confirm", starts_at: "2027-09-26T04:30:00.000Z" },
  detail: null,
  since: "2027-09-18T05:00:00.000Z",
  due,
  owner: null,
});

const ROWS: Row[] = [
  { group: "address_to_confirm", task: task("1", "Kunal Mehta", "2027-09-20T18:30:00.000Z"), owner: ME },
  { group: "address_to_confirm", task: task("2", "Rohit Malhotra", "2027-09-24T18:30:00.000Z"), owner: null },
  { group: "number_change", task: task("3", "Arjun Sethi", "2027-09-25T18:30:00.000Z"), owner: "anil@maneman.in" },
];

describe("the views of Tasks", () => {
  it("count every task, the person's own, nobody's and the overdue", () => {
    expect(narrowed(ROWS, NO_FILTER, ME, NOW).counts).toEqual({ all: 3, mine: 1, nobody: 1, overdue: 1 });
  });

  it("list the view asked for", () => {
    const names = (view: "mine" | "nobody" | "overdue") =>
      narrowed(ROWS, { ...NO_FILTER, view }, ME, NOW).rows.map((row) => row.task.person?.name);
    expect(names("mine")).toEqual(["Kunal Mehta"]);
    expect(names("nobody")).toEqual(["Rohit Malhotra"]);
    expect(names("overdue")).toEqual(["Kunal Mehta"]);
  });

  it("count each view over the kind and the client asked for", () => {
    const found = narrowed(ROWS, { ...NO_FILTER, kind: "address_to_confirm", search: "rohit" }, ME, NOW);
    expect(found.counts).toEqual({ all: 1, mine: 0, nobody: 1, overdue: 0 });
    expect(narrowed(ROWS, { ...NO_FILTER, search: "98123" }, ME, NOW).rows).toHaveLength(3);
  });

  it("has no one's own while nobody is known to be signed in", () => {
    expect(narrowed(ROWS, { ...NO_FILTER, view: "mine" }, null, NOW).rows).toEqual([]);
  });
});
