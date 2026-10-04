// Which staging clients take the Books customer FSM's own integration made for them, when staging leaves FSM
// (scripts/lib/link-books-customers.ts). Every ID here is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  linkStatement,
  planLinks,
  readContactAnswer,
  type FsmContactRead,
} from "../../scripts/lib/link-books-customers.ts";

const NOW = new Date("2026-10-04T12:00:00.000Z");

describe("FSM's answer for a contact", () => {
  it("names the Books customer FSM linked it to", () => {
    const body = { data: [{ id: "8229000000305231", ZBilling_Id: "4242595000000061001" }] };
    expect(readContactAnswer(200, body)).toEqual({ state: "customer", customerId: "4242595000000061001" });
  });

  it("says when FSM made no Books customer for it", () => {
    expect(readContactAnswer(200, { data: [{ id: "8229000000305231", ZBilling_Id: null }] })).toEqual({
      state: "no_customer",
    });
    expect(readContactAnswer(200, { data: [{ id: "8229000000305231" }] })).toEqual({ state: "no_customer" });
  });

  it("says a contact FSM no longer holds is gone", () => {
    expect(readContactAnswer(204, null)).toEqual({ state: "gone" });
    expect(readContactAnswer(404, null)).toEqual({ state: "gone" });
    expect(readContactAnswer(200, { data: [] })).toEqual({ state: "gone" });
  });

  it("says anything else could not be read, with FSM's status", () => {
    expect(readContactAnswer(401, { code: "INVALID_TOKEN" })).toEqual({ state: "unreadable", status: 401 });
    expect(readContactAnswer(200, { data: "nonsense" })).toEqual({ state: "unreadable", status: 200 });
  });
});

describe("the plan", () => {
  const person = (id: string) => ({ id, fsm_contact_id: `contact-${id}` });
  const reads = (entries: Record<string, FsmContactRead>) =>
    new Map(Object.entries(entries).map(([id, read]) => [`contact-${id}`, read]));

  it("links each client to the customer FSM made for them", () => {
    const plan = planLinks(
      [person("p1"), person("p2")],
      reads({ p1: { state: "customer", customerId: "c1" }, p2: { state: "customer", customerId: "c2" } }),
      new Set(),
    );

    expect(plan.links).toEqual([
      { personId: "p1", customerId: "c1" },
      { personId: "p2", customerId: "c2" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a client with no customer, a contact gone or unread, and a customer another client holds", () => {
    const plan = planLinks(
      [person("p1"), person("p2"), person("p3"), person("p4"), person("p5")],
      reads({
        p1: { state: "no_customer" },
        p2: { state: "gone" },
        p3: { state: "unreadable", status: 500 },
        p4: { state: "customer", customerId: "held" },
      }),
      new Set(["held"]),
    );

    expect(plan.links).toEqual([]);
    expect(plan.skipped).toEqual([
      { personId: "p1", reason: "FSM made no Books customer for them" },
      { personId: "p2", reason: "FSM no longer holds their contact" },
      { personId: "p3", reason: "FSM answered 500" },
      { personId: "p4", reason: "another client holds that customer" },
      { personId: "p5", reason: "FSM was not asked" },
    ]);
  });

  it("gives a customer FSM linked to two contacts to the first client only", () => {
    const plan = planLinks(
      [person("p1"), person("p2")],
      reads({ p1: { state: "customer", customerId: "c1" }, p2: { state: "customer", customerId: "c1" } }),
      new Set(),
    );

    expect(plan.links).toEqual([{ personId: "p1", customerId: "c1" }]);
    expect(plan.skipped).toEqual([{ personId: "p2", reason: "another client holds that customer" }]);
  });
});

describe("the statement a link runs", () => {
  function database() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      `CREATE TABLE people (id TEXT PRIMARY KEY, books_customer_id TEXT, books_details_changed_at TEXT);
       CREATE UNIQUE INDEX people_by_books_customer ON people (books_customer_id) WHERE books_customer_id IS NOT NULL;
       INSERT INTO people (id) VALUES ('p1'), ('p2');`,
    );
    return sqlite;
  }
  const rows = (sqlite: DatabaseSync) => sqlite.prepare("SELECT * FROM people ORDER BY id").all();

  it("keeps the customer on the client and marks their details for the Books pass to write", () => {
    const sqlite = database();

    sqlite.exec(linkStatement({ personId: "p1", customerId: "c1" }, NOW));

    expect(rows(sqlite)).toEqual([
      { id: "p1", books_customer_id: "c1", books_details_changed_at: NOW.toISOString() },
      { id: "p2", books_customer_id: null, books_details_changed_at: null },
    ]);
  });

  it("changes nothing for a client linked since, or a customer another client took since", () => {
    const sqlite = database();
    sqlite.exec("UPDATE people SET books_customer_id = 'mine' WHERE id = 'p1'");

    sqlite.exec(linkStatement({ personId: "p1", customerId: "c1" }, NOW));
    sqlite.exec(linkStatement({ personId: "p2", customerId: "mine" }, NOW));

    expect(rows(sqlite)).toEqual([
      { id: "p1", books_customer_id: "mine", books_details_changed_at: null },
      { id: "p2", books_customer_id: null, books_details_changed_at: null },
    ]);
  });

  it("quotes what it is given", () => {
    expect(linkStatement({ personId: "p'1", customerId: "c1" }, NOW)).toContain("'p''1'");
  });
});
