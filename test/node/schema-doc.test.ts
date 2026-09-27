import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAY_VALUED_AT, migratedTables, PURPOSES, schemaDoc } from "../../scripts/lib/schema-doc.ts";

const migration = (name: string, sql: string) => ({ name, sql });

describe("reading the schema from the migrations", () => {
  const tables = migratedTables([
    migration("0001_people.sql", "CREATE TABLE people (id TEXT PRIMARY KEY, mobile TEXT NOT NULL UNIQUE);"),
    migration(
      "0002_leads.sql",
      [
        "CREATE TABLE leads (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), state TEXT NOT NULL DEFAULT 'new', created_at TEXT);",
        "CREATE INDEX leads_waiting ON leads (created_at) WHERE state = 'new';",
      ].join("\n"),
    ),
    migration("0003_people_name.sql", "ALTER TABLE people ADD COLUMN name TEXT;"),
  ]);

  it("names each table with the migration that made it and those that changed it", () => {
    expect(tables.map((table) => [table.name, table.createdIn, table.changedIn])).toEqual([
      ["leads", "0002_leads.sql", []],
      ["people", "0001_people.sql", ["0003_people_name.sql"]],
    ]);
  });

  it("reads each column's type, whether it may be empty, its default and its key", () => {
    const leads = tables.find((table) => table.name === "leads");
    expect(leads?.columns).toEqual([
      { name: "id", type: "TEXT", notNull: false, defaultValue: null, primaryKey: true, references: null },
      {
        name: "person_id",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKey: false,
        references: "people.id",
      },
      { name: "state", type: "TEXT", notNull: true, defaultValue: "'new'", primaryKey: false, references: null },
      { name: "created_at", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false, references: null },
    ]);
  });

  it("reads each index, whether it is unique, and a partial one's condition", () => {
    const [leads, people] = tables;
    expect(leads?.indexes).toEqual([
      { name: "leads_waiting", unique: false, columns: ["created_at"], where: "state = 'new'" },
    ]);
    expect(people?.indexes).toEqual([{ name: "(unique)", unique: true, columns: ["mobile"], where: null }]);
  });
});

describe("the repository's schema", () => {
  const migrations = readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => migration(name, readFileSync(`migrations/${name}`, "utf8")));
  const tables = migratedTables(migrations);

  it("gives every table a line saying what it holds, and no line to a table that is gone", () => {
    const names = tables.map((table) => table.name);
    expect(names.filter((name) => PURPOSES[name] === undefined)).toEqual([]);
    expect(Object.keys(PURPOSES).filter((name) => !names.includes(name))).toEqual([]);
  });

  it("names only columns that exist as the _at columns that hold a day", () => {
    for (const column of Object.keys(DAY_VALUED_AT)) {
      const [table, name] = column.split(".");
      expect(
        tables.find((each) => each.name === table)?.columns.map((each) => each.name),
        column,
      ).toContain(name);
    }
  });

  it("keeps every _date column as text, a day written YYYY-MM-DD", () => {
    const dates = tables.flatMap((table) => table.columns.filter((column) => column.name.endsWith("_date")));
    expect(dates.length).toBeGreaterThan(3);
    for (const column of dates) expect(column.type, column.name).toBe("TEXT");
  });

  it("is docs/schema.md as npm run schema writes it", () => {
    expect(readFileSync("docs/schema.md", "utf8")).toBe(schemaDoc(tables));
  });
});
