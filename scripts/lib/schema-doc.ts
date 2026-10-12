// docs/schema.md, written from the migrations themselves: they are applied in
// order to an empty database, and each table is read back as they leave it
// (npm run schema; test/node/database/schema-doc.test.ts). What a table is for is the
// one thing the schema cannot say, so it is written once here, and the test
// fails on a table that has no line or a line whose table is gone.

import { DatabaseSync } from "node:sqlite";
import { PURPOSES } from "./schema-purposes.ts";

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

export interface RestoreGroup {
  readonly what: string;
  readonly tables: readonly string[];
  /** What it means when the tables are left as they were at <T>. */
  readonly leftAtT: string;
  readonly putBackBy: string;
}

/** What a restore to an earlier minute undoes, group by group. Every table is in one, and may be in more. */
export const RESTORE_GROUPS: readonly RestoreGroup[] = [
  {
    what: "Consents given and withdrawn",
    tables: ["consents"],
    leftAtT: "Someone who said stop is messaged again",
    putBackBy: "Adding the rows since `<T>`: they are only ever added",
  },
  {
    what: "Revoked sessions and phones",
    tables: ["sessions", "technician_devices"],
    leftAtT: "A lost phone, or a session that was ended, works again",
    putBackBy: "Revoking again: a phone in the console, a client's session with `sessions.revoked_at`",
  },
  {
    what: "Erasures",
    tables: [
      "people",
      "addresses",
      "waitlist_entries",
      "number_change_requests",
      "photos",
      "photo_sets",
      "hair_profiles",
      "grievances",
      "no_show_disputes",
      "task_closures",
    ],
    leftAtT: "Erased people come back in D1, with their own words. Their files stay gone, since R2 is not restored",
    putBackBy:
      "Erasing again (runbook, \"Erasure within the day\"). List them before restoring: `SELECT id FROM people WHERE erased_at >= '<T>';`",
  },
  {
    what: "Number changes, deletion requests, grievances",
    tables: ["number_change_requests", "people", "deletion_requests", "grievances"],
    leftAtT: "A client's new number stops working; a request, or its answer, is lost",
    putBackBy: "Deciding each again in the console",
  },
  {
    what: "Payments and refunds",
    tables: ["payments", "refunds", "razorpay_events", "payment_links"],
    leftAtT:
      "Money Razorpay took or gave back is unrecorded, and Razorpay does not send it again. A payment link sent since has no row, though a payment on it still finds its visit",
    putBackBy: "Adding the rows since `<T>`, checked against Razorpay's dashboard",
  },
  {
    what: "Discount codes",
    tables: ["discount_codes", "discount_code_uses"],
    leftAtT:
      "A code made or switched off since goes back, and a use since is forgotten, so a single-use code works again",
    putBackBy: "Making or switching off the code again in the console. `discount_code_uses` is only ever added to",
  },
  {
    what: "Bookings and moves",
    tables: [
      "appointments",
      "slot_holds",
      "slot_claims",
      "dispatch_moves",
      "move_proposals",
      "visit_changes",
      "consultation_requests",
      "first_fit_requests",
    ],
    leftAtT:
      "A visit booked, moved or cancelled since is lost, and its time can be booked again. Where FSM still holds visits, the cron books them there a second time",
    putBackBy: "The rows since `<T>`, before the switch is turned off",
  },
  {
    what: "Messages",
    tables: ["outbound_messages"],
    leftAtT: "The sweeper sends again what was sent since",
    putBackBy: "The rows since `<T>`, before the switch is turned off",
  },
  {
    what: "The Care inbox",
    tables: [
      "conversations",
      "chat_messages",
      "care_owners",
      "care_weekly_off",
      "care_leave",
      "care_names",
      "city_matters",
      "quick_replies",
      "remedies",
      "technician_updates",
    ],
    leftAtT: "A message written since, the client's or ours, is gone from its thread",
    putBackBy: "The rows since `<T>`; WhatsApp's own copy shows what was said",
  },
  {
    what: "Technicians' steps, pieces and photographs",
    tables: [
      "job_events",
      "checkins",
      "visits",
      "consumables_used",
      "no_show_cases",
      "no_show_disputes",
      "pieces",
      "photos",
      "photo_sets",
    ],
    leftAtT:
      "Steps, check-ins, outcomes, pieces fitted, no-shows and disputes since are lost; a photograph's file is kept with no row",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Hair profiles",
    tables: ["hair_profiles"],
    leftAtT: "A profile recorded since is lost, and one an erasure blanked since is whole again",
    putBackBy: "Adding the rows since `<T>`: they are only ever added. Erasing again blanks the rest",
  },
  {
    what: "Stock",
    tables: ["stock_movements", "stock_places"],
    leftAtT:
      "A delivery, transfer, count or loss recorded since, or a job's use, is lost, so what each place holds is wrong; a hub or stockroom added or changed since goes back",
    putBackBy: "Adding the rows since `<T>`",
  },
  {
    what: "Referrals and credits",
    tables: [
      "referral_codes",
      "referral_attributions",
      "credit_ledger",
      "waitlist_entries",
      "referral_channels",
      "channel_attributions",
      "partner_payouts",
      "spend_entries",
    ],
    leftAtT:
      "A credit, a grant, a partner, a partner's payment, an entry of offline spend or a place on a waitlist disappears",
    putBackBy: "The rows since `<T>`. `credit_ledger` is only ever added to",
  },
  {
    what: "Ops' settings and what we sell",
    tables: [
      "ops_settings",
      "price_book",
      "standard_costs",
      "targets",
      "services",
      "slot_times",
      "serviceable_pincodes",
      "technician_leave",
      "visit_blackouts",
      "city_blackouts",
      "cities",
      "zones",
      "consumables",
      "consumable_usage",
      "checklist_items",
      "partial_reasons",
      "lost_reasons",
      "pay_grades",
      "visit_pay_rates",
      "word_versions",
      "site_word_publishes",
    ],
    leftAtT:
      "A price, service, rule, area, day's times, day off, consumable, job-sheet list, pay rate or wording set since goes back",
    putBackBy: "Setting it again in the console, which audits it",
  },
  {
    what: "Staff and access",
    tables: ["staff", "staff_grants", "staff_service_tokens", "staff_access_mode"],
    leftAtT: "Someone taken off the Staff list since, or a grant taken back, is let in again",
    putBackBy: "Setting it again on the Staff page, before anything else",
  },
  {
    what: "Tasks",
    tables: ["task_owners", "task_closures", "task_spans"],
    leftAtT:
      "A task closed since opens again, one given to someone since is nobody's, and a task's span closed since closes again the next night, dated then",
    putBackBy: "Closing or giving it again on the Tasks board",
  },
  {
    what: "The audit log",
    tables: ["audit_log"],
    leftAtT: "Who did what since `<T>`",
    putBackBy: "Adding the rows since `<T>`: they are only ever added",
  },
  {
    what: "New people, leads, addresses and try-ons",
    tables: ["people", "leads", "addresses", "tryon_jobs"],
    leftAtT: "Bookings and leads made since are lost here; the CRM has the leads",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Technicians, and FSM's catalogue",
    tables: ["technicians", "fsm_items"],
    leftAtT: "A technician added or changed since goes back",
    putBackBy: "Where FSM still holds them, the cron reads them again; otherwise the rows since `<T>`",
  },
  {
    what: "Worked out from other tables",
    tables: ["last_visits", "ops_settings_snapshot", "stock_balances"],
    leftAtT: "Nothing of their own: triggers keep each from the table it is worked out from",
    putBackBy: "Putting back that table",
  },
  {
    what: "The storage meter",
    tables: ["stored_objects", "storage_meter"],
    leftAtT: "Objects stored or deleted since are counted wrongly, as R2 is not restored",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Housekeeping",
    tables: [
      "alerts",
      "board_version",
      "cron_jobs",
      "cron_runs",
      "credit_expiry_cursor",
      "counters",
      "idempotency",
      "number_codes",
      "otp_challenges",
      "tryon_sessions",
      "events",
      "sync_cursors",
      "webhook_inbox",
      "zoho_access_tokens",
      "zoho_token",
      "zoho_tokens",
    ],
    leftAtT: "Nothing that lasts",
    putBackBy: "Nothing",
  },
  {
    what: "The database's identity, and the restore's own switch",
    tables: ["deployment_identity", "maintenance"],
    leftAtT: "The identity is the same at every minute. Going back undoes the switch, so the steps turn it on again",
    putBackBy: "Nothing",
  },
];

/** The `_at` columns that hold a calendar day, not an instant, and how each is read. */
export const DAY_VALUED_AT: Readonly<Record<string, string>> = {
  "pieces.fitted_at":
    "The day FSM's asset says the piece was installed (`Installation_Date`), or the day the technician's app fitted it (`src/domain/field/pieces.ts`).",
  "pieces.replacement_due_at":
    "The fitted day plus the base's cycle; the Tasks board reads it as midnight in India on that day (`instantOf`, `src/domain/ops/tasks.ts`).",
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

function restoreGroupRow(group: RestoreGroup): string {
  return `| ${group.what} | ${group.tables.map(code).join(", ")} | ${group.leftAtT} | ${group.putBackBy} |`;
}

function restoreSection(): string[] {
  return [
    "## What a restore undoes",
    "",
    'What each group of tables means if it is left as it was at `<T>`, and how it is put back (`docs/runbook.md`, "Restoring D1"). A table may be in more than one group. Every table is in one: the test fails on a table that is not, until it is added to `RESTORE_GROUPS` (`scripts/lib/schema-doc.ts`).',
    "",
    "| What | Tables | Left at `<T>` | Put back by |",
    "| --- | --- | --- | --- |",
    ...RESTORE_GROUPS.map(restoreGroupRow),
    "",
  ];
}

export function schemaDoc(tables: readonly Table[]): string {
  return [
    "# The database schema",
    "",
    "What each table in D1 holds, as the migrations leave it. This file is written by `npm run schema`, which applies `migrations/` in order to an empty database and reads every table back; `test/node/database/schema-doc.test.ts` fails until it is run after a migration changes a table. How to write a migration is `docs/migrations.md`.",
    "",
    "## Times and dates",
    "",
    "A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`). One ending `_date` holds a calendar day in India, `YYYY-MM-DD`, and a day is never cut from an instant's UTC string: it is read as India's date (`src/lib/india-time.ts`). Two `_at` columns hold a day, from before the rule was written (`docs/migrations.md`, rule 7):",
    "",
    ...Object.entries(DAY_VALUED_AT).map(([column, how]) => `- ${code(column)}: ${how}`),
    "",
    ...restoreSection(),
    "## Tables",
    "",
    ...tables.map((table) => `- [${table.name}](#${table.name}): ${PURPOSES[table.name] ?? ""}`),
    "",
    ...tables.flatMap(tableSection),
  ].join("\n");
}
