// Every table holding a client's rows is answered for in src/policy/personal-data.ts: what their data export leaves
// out, and what their erasure does. This runs the export and the erasure against the migrated schema and holds the
// code to those answers, so a table or a column added to the schema fails here until both are decided.

import { constants, type DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MY_DATA } from "../../../src/config/my-data.ts";
import { EXPORT_QUERIES, everythingHeldAbout } from "../../../src/domain/data-export.ts";
import { erasePerson } from "../../../src/domain/erasure.ts";
import { logPhotoView } from "../../../src/domain/photo-views.ts";
import { createLogger } from "../../../src/log.ts";
import { PERSONAL_COLUMNS } from "../../../src/policy/personal-data.ts";
import { asD1, migratedDatabase } from "../d1-over-sqlite.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-04T06:30:00.000Z");
const PERSON_COLUMNS = ["person_id", "subject_id", "referred_person_id"];

function columnsOf(db: DatabaseSync, table: string): string[] {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return columns.map((column) => column.name);
}

/** Every table holding a person's rows: the people table, and each with a column naming a person. */
function personalTables(db: DatabaseSync): string[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  const named = tables.filter(({ name }) => columnsOf(db, name).some((column) => PERSON_COLUMNS.includes(column)));
  return ["people", ...named.map(({ name }) => name)].sort();
}

function withPerson(db: DatabaseSync): void {
  db.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit')").run(
    PERSON,
    NOW.toISOString(),
  );
}

/** Every "table.column" the export's statements give back as a value of their own. */
async function columnsExported(): Promise<Set<string>> {
  const db = migratedDatabase();
  const given = new Set<string>();
  const heard = (sql: string) => {
    for (const column of db.prepare(sql).columns()) {
      if (column.table !== null) given.add(`${column.table}.${String(column.column)}`);
    }
  };
  await everythingHeldAbout(asD1(db, heard), PERSON);
  return given;
}

/** What the erasure's own statements delete and blank, apart from what triggers then do. */
async function erasureTouches(): Promise<{ deleted: Set<string>; updated: Set<string> }> {
  const db = migratedDatabase();
  withPerson(db);
  const deleted = new Set<string>();
  const updated = new Set<string>();
  db.setAuthorizer((action, table, column, _database, trigger) => {
    if (trigger === null && table !== null && action === constants.SQLITE_DELETE) deleted.add(table);
    if (trigger === null && table !== null && action === constants.SQLITE_UPDATE) updated.add(`${table}.${column}`);
    return constants.SQLITE_OK;
  });
  const noFiles = {} as R2Bucket;
  const env = { DB: asD1(db), UPLOADS: noFiles, RESULTS: noFiles, CLIENT_PHOTOS: noFiles, REFERRAL_CARDS: noFiles };
  await erasePerson(env, PERSON, NOW, createLogger());
  return { deleted, updated };
}

describe("the tables that hold a client's rows", () => {
  const db = migratedDatabase();

  it("each have an answer for the export and the erasure, and no answer names a table that holds none", () => {
    expect(Object.keys(PERSONAL_COLUMNS).sort()).toEqual(personalTables(db));
  });

  it("name only columns their table has", () => {
    for (const [table, answer] of Object.entries(PERSONAL_COLUMNS)) {
      const columns = columnsOf(db, table);
      const named = [...answer.leftOut, ...(answer.erasure.blanks ?? [])];
      expect(
        named.filter((column) => !columns.includes(column)),
        table,
      ).toEqual([]);
    }
  });

  it("say why whatever the export leaves out is left out, and what the erasure does", () => {
    for (const [table, answer] of Object.entries(PERSONAL_COLUMNS)) {
      if (answer.leftOut.length > 0) expect(answer.whyLeftOut, table).not.toBe("");
      expect(answer.erasure.why, table).not.toBe("");
    }
  });
});

describe("the data export", () => {
  it("gives every column of a client's tables that is not left out", async () => {
    const db = migratedDatabase();
    const exported = await columnsExported();
    const missing = Object.entries(PERSONAL_COLUMNS).flatMap(([table, answer]) =>
      columnsOf(db, table)
        .filter((column) => !answer.leftOut.includes(column))
        .map((column) => `${table}.${column}`)
        .filter((column) => !exported.has(column)),
    );
    expect(missing).toEqual([]);
  });
});

describe("the erasure", () => {
  it("deletes and blanks what each answer says it does", async () => {
    const { deleted, updated } = await erasureTouches();
    for (const [table, answer] of Object.entries(PERSONAL_COLUMNS)) {
      if (answer.erasure.deletes === true) expect(deleted, table).toContain(table);
      const blanked = (answer.erasure.blanks ?? []).map((column) => `${table}.${column}`);
      expect(
        blanked.filter((column) => !updated.has(column)),
        table,
      ).toEqual([]);
    }
  });
});

describe("the readable copy's labels", () => {
  it("cover every part of the export, and name no part it does not have", () => {
    expect(Object.keys(MY_DATA.parts).sort()).toEqual(
      [...Object.keys(EXPORT_QUERIES), "hair_profile", "photo_views"].sort(),
    );
  });

  it("label every field each query gives, and no other", () => {
    const db = migratedDatabase();
    const parts: Readonly<Record<string, { fields: Readonly<Record<string, unknown>> }>> = MY_DATA.parts;
    for (const [part, sql] of Object.entries(EXPORT_QUERIES)) {
      const given = db
        .prepare(sql)
        .columns()
        .map((column) => column.name);
      expect(Object.keys(parts[part]?.fields ?? {}).sort(), part).toEqual(given.sort());
    }
  });

  it("label every field of a hair profile's version and a photograph's view", async () => {
    const db = migratedDatabase();
    withPerson(db);
    db.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, norwood_stage, head_circumference_cm,
         front_to_nape_cm, ear_to_ear_cm, temple_to_temple_cm, base_width_in, base_length_in, colour, grey_percent,
         density_percent, wave, hairline, product, attachment, remedies, transplant_year, skin_and_allergies)
       VALUES ('profile-1', ?1, 'ops@maneman.in', ?2, 'III', 57, 36, 30, 28, 7, 9, '1B', 10, 100, 'straight',
         'natural', 'classic', 'tape', '["minoxidil"]', 2019, 'None known')`,
    ).run(PERSON, NOW.toISOString());
    const d1 = asD1(db);
    await logPhotoView(d1, {
      personId: PERSON,
      actor: { kind: "staff", id: "ops@maneman.in" },
      requestId: "r",
      now: NOW,
    });

    const held = (await everythingHeldAbout(d1, PERSON)) as {
      hair_profile: Record<string, unknown>[];
      photo_views: Record<string, unknown>[];
    };

    expect(Object.keys(held.hair_profile[0] ?? {}).sort()).toEqual(
      Object.keys(MY_DATA.parts.hair_profile.fields).sort(),
    );
    expect(Object.keys(held.photo_views[0] ?? {}).sort()).toEqual(Object.keys(MY_DATA.parts.photo_views.fields).sort());
  });
});
