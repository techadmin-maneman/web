// docs/schema.md, written from the migrations themselves: they are applied in
// order to an empty database, and each table is read back as they leave it
// (npm run schema; test/node/schema-doc.test.ts). What a table is for is the
// one thing the schema cannot say, so it is written once here, and the test
// fails on a table that has no line or a line whose table is gone.

import { DatabaseSync } from "node:sqlite";

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
  /** "people.id" for a column that points at another table's. */
  readonly references: string | null;
}

export interface Index {
  /** "(unique)" for one a UNIQUE constraint made. */
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  /** A partial index's condition. */
  readonly where: string | null;
}

export interface Table {
  readonly name: string;
  readonly createdIn: string;
  readonly changedIn: readonly string[];
  readonly columns: readonly Column[];
  readonly indexes: readonly Index[];
  readonly triggers: readonly string[];
}

/** What each table holds, in a line. */
export const PURPOSES: Readonly<Record<string, string>> = {
  addresses:
    "Each address a client has given. The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054).",
  alerts: "One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).",
  appointments:
    "The mirror of FSM's appointments: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice (ADR 0032).",
  audit_log:
    "Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).",
  checkins: 'Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065).',
  checklist_items:
    "Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).",
  cities:
    "The cities Phase 1's booking form offered. The leads it left name one, a booking's lead names its pincode's, and the dispatch board filters by them.",
  consents:
    "What each person agreed to, and under which notice's version. Rows are only ever added (ADR 0042, ADR 0049).",
  consultation_requests:
    "A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).",
  consumable_usage:
    "What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).",
  consumables:
    "The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).",
  consumables_used:
    "The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).",
  counters: "Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).",
  credit_ledger:
    "Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).",
  cron_jobs: "Each job of the five-minute cron, and how many runs in a row it has failed (ADR 0067).",
  deletion_requests: "A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).",
  deployment_identity: "Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).",
  dispatch_moves:
    "Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).",
  events: "What happened, for analysis, with no personal data in its payload.",
  first_fit_requests:
    "A first fit asked for on the site's form with the consultation, for the app to offer once the consultation is done; a person's latest stands (ADR 0086).",
  fsm_items:
    "FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).",
  grievances: "A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).",
  idempotency: "The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).",
  job_events:
    "The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).",
  last_visits:
    "Each client's last first fit, service or replacement done, and last consultation done, kept by triggers from the view `last_visits_now` as their visits change; the Tasks board's At-risk client and First fit to book read it (ADR 0086).",
  leads:
    "Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).",
  no_show_cases: "The evidence a no-show is ruled on, and the ruling (ADR 0065, ADR 0072).",
  number_change_requests:
    "A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).",
  ops_settings:
    "The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).",
  ops_settings_snapshot:
    "One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).",
  otp_challenges: "Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).",
  partial_reasons:
    "The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).",
  outbound_messages: "Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).",
  payments: "The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).",
  people:
    "One row per person, keyed by mobile number. D1 owns the identity; the CRM's ID is only a reference (ADR 0011).",
  photo_sets: "A visit's set of photographs, before or after (ADR 0028).",
  photos: "One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).",
  pieces:
    "The mirror of FSM's assets: each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason (ADR 0032).",
  price_book:
    "Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).",
  razorpay_events: "Each Razorpay webhook event, once, by its event ID (ADR 0044).",
  referral_attributions:
    "A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).",
  referral_codes: "A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).",
  refunds: "The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).",
  serviceable_pincodes:
    "Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).",
  services:
    "What clients may book: each kind of visit's services, their names, lengths and order, when each is retired, and its item in FSM's catalogue; the price book prices each by its kind and tier (ADR 0085).",
  sessions:
    "The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).",
  slot_claims:
    "What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).",
  slot_holds: "A slot held while a client pays, and what became of it (ADR 0045, ADR 0068).",
  stock_balances:
    "What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).",
  stock_movements:
    "Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).",
  stored_objects:
    "Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).",
  storage_meter:
    "What Phase 2's two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093).",
  sync_cursors: "Where each pass of the reconciliation with FSM has reached (ADR 0032).",
  technician_devices: "The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).",
  technician_leave: "A technician's leave in whole days, which the clash check reads beside `slot_claims` (ADR 0062).",
  technicians:
    "The mirror of FSM's technicians: name, initials, mobile number and zone; and on staging the few written by hand for a test, which the sync leaves alone (ADR 0032, ADR 0052).",
  tryon_jobs: "One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).",
  tryon_sessions: "The try-on gate's session, which shows a visitor their result without the gate again (ADR 0014).",
  visit_blackouts: "Days on which no visit is offered.",
  visit_changes: "Each move or cancel a client made, with its notice and what it cost (ADR 0046).",
  visits: "What an appointment became once FSM closed it: the outcome, its reason and its times (ADR 0032, ADR 0074).",
  waitlist_entries: "Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).",
  webhook_inbox: "FSM's webhook deliveries, each kept once (ADR 0032).",
  zoho_access_tokens:
    "Each Zoho client's access token, and the lease one caller holds while it asks for a new one (ADR 0070).",
  zoho_token: "The CRM's access token before migration 0041; unread since, and dropped later (open point 90).",
  zoho_tokens: "FSM's and Books' access token before migration 0041; unread since, and dropped later (open point 90).",
};

/** The `_at` columns that hold a calendar day, not an instant, and how each is read. */
export const DAY_VALUED_AT: Readonly<Record<string, string>> = {
  "pieces.fitted_at":
    "The day FSM's asset says the piece was installed (`Installation_Date`), or the day the technician's app fitted it (`src/domain/pieces.ts`).",
  "pieces.replacement_due_at":
    "The fitted day plus the base's cycle; the Tasks board reads it as midnight in India on that day (`instantOf`, `src/domain/tasks.ts`).",
};

const TABLES_READ = `SELECT name, sql FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
  ORDER BY name`;

interface Row {
  readonly name: string;
  readonly sql: string;
}

/** A table's own statement, its indexes' and its triggers': what a migration changes when it changes the table. */
function signature(db: DatabaseSync, table: string): string {
  const parts = db
    .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type, name")
    .all(table) as unknown as { sql: string }[];
  return parts.map((part) => part.sql).join("\n");
}

function columnsOf(db: DatabaseSync, table: string): Column[] {
  const keys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as unknown as {
    from: string;
    table: string;
    to: string | null;
  }[];
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];
  return info.map((column) => {
    const key = keys.find((each) => each.from === column.name);
    return {
      name: column.name,
      type: column.type,
      notNull: column.notnull === 1,
      defaultValue: column.dflt_value,
      primaryKey: column.pk > 0,
      references: key === undefined ? null : `${key.table}.${key.to ?? "rowid"}`,
    };
  });
}

function indexesOf(db: DatabaseSync, table: string): Index[] {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as unknown as {
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];
  return list
    .filter((index) => index.origin !== "pk")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((index) => {
      const columns = (db.prepare(`PRAGMA index_info("${index.name}")`).all() as unknown as { name: string }[]).map(
        (column) => column.name,
      );
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(index.name) as { sql: string | null } | undefined
      )?.sql;
      const where = index.partial === 1 && sql ? (/\bWHERE\s+([\s\S]+?)\s*;?\s*$/i.exec(sql)?.[1] ?? null) : null;
      return {
        name: index.origin === "u" ? "(unique)" : index.name,
        unique: index.unique === 1,
        columns,
        where: where === null ? null : where.replace(/\s+/g, " "),
      };
    });
}

function triggersOf(db: DatabaseSync, table: string): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name")
    .all(table) as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

/** Every table the migrations leave, with the migration that made it and those that changed it since. */
export function migratedTables(migrations: readonly MigrationFile[]): Table[] {
  const db = new DatabaseSync(":memory:");
  const history = new Map<string, { createdIn: string; changedIn: string[]; signature: string }>();
  for (const migration of migrations) {
    db.exec(migration.sql);
    const present = db.prepare(TABLES_READ).all() as unknown as Row[];
    for (const name of [...history.keys()]) {
      if (!present.some((row) => row.name === name)) history.delete(name);
    }
    for (const { name } of present) {
      const now = signature(db, name);
      const known = history.get(name);
      if (known === undefined) history.set(name, { createdIn: migration.name, changedIn: [], signature: now });
      else if (known.signature !== now)
        history.set(name, { ...known, changedIn: [...known.changedIn, migration.name], signature: now });
    }
  }
  return [...history.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { createdIn, changedIn }]) => ({
      name,
      createdIn,
      changedIn,
      columns: columnsOf(db, name),
      indexes: indexesOf(db, name),
      triggers: triggersOf(db, name),
    }));
}

const code = (text: string): string => `\`${text}\``;

function columnRow(column: Column): string {
  const notes = [
    column.primaryKey ? "primary key" : "",
    column.references === null ? "" : `→ ${code(column.references)}`,
  ].filter((note) => note !== "");
  const empty = column.notNull || column.primaryKey ? "no" : "yes";
  const fallback = column.defaultValue === null ? "" : code(column.defaultValue);
  return `| ${code(column.name)} | ${column.type || "any"} | ${empty} | ${fallback} | ${notes.join("; ")} |`;
}

function indexLine(index: Index): string {
  const kind = index.unique ? "unique on" : "on";
  const where = index.where === null ? "" : `, where ${code(index.where)}`;
  const name = index.name === "(unique)" ? "A `UNIQUE` constraint" : code(index.name);
  return `- ${name}: ${kind} (${index.columns.map(code).join(", ")})${where}`;
}

function tableSection(table: Table): string[] {
  const changed = table.changedIn.length === 0 ? "" : `; changed by ${table.changedIn.map(code).join(", ")}`;
  return [
    `## ${table.name}`,
    "",
    PURPOSES[table.name] ?? "",
    "",
    `Made by ${code(table.createdIn)}${changed}.`,
    "",
    "| Column | Type | May be empty | Default | Key |",
    "| --- | --- | --- | --- | --- |",
    ...table.columns.map(columnRow),
    "",
    ...(table.indexes.length === 0 ? [] : ["Indexes:", "", ...table.indexes.map(indexLine), ""]),
    ...(table.triggers.length === 0 ? [] : [`Triggers: ${table.triggers.map(code).join(", ")}.`, ""]),
  ];
}

export function schemaDoc(tables: readonly Table[]): string {
  return [
    "# The database schema",
    "",
    "What each table in D1 holds, as the migrations leave it. This file is written by `npm run schema`, which applies `migrations/` in order to an empty database and reads every table back; `test/node/schema-doc.test.ts` fails until it is run after a migration changes a table. How to write a migration is `docs/migrations.md`.",
    "",
    "## Times and dates",
    "",
    "A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`). One ending `_date` holds a calendar day in India, `YYYY-MM-DD`, and a day is never cut from an instant's UTC string: it is read as India's date (`src/lib/india-time.ts`). Two `_at` columns hold a day, from before the rule was written (`docs/migrations.md`, rule 7):",
    "",
    ...Object.entries(DAY_VALUED_AT).map(([column, how]) => `- ${code(column)}: ${how}`),
    "",
    "## Tables",
    "",
    ...tables.map((table) => `- [${table.name}](#${table.name}): ${PURPOSES[table.name] ?? ""}`),
    "",
    ...tables.flatMap(tableSection),
  ].join("\n");
}
