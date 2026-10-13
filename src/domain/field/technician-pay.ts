// What a technician is paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md): the
// seniority grades ops name, each technician's grade, and a rate per grade and kind of visit, for every city or for one,
// from a date. Finance sets them in the console; the payroll provider will read them. Each change is one batch with
// its audit entry, which keeps IDs, codes and amounts, never a grade's name.

import { auditStatement, type AuditActor } from "../platform/audit.ts";

export const VISIT_PAY_KINDS = ["consultation", "one_visit", "first_fit", "service", "replacement", "no_show"] as const;
type VisitPayKind = (typeof VISIT_PAY_KINDS)[number];

/** The most one visit may pay, in paise: a guard against a figure typed a hundred times too big. */
export const MAX_VISIT_PAY = 1_000_000;

interface PayGrade {
  readonly id: string;
  readonly name: string;
  readonly technicians: number;
}

interface PayTechnician {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly grade_id: string | null;
}

interface PayRate {
  readonly grade_id: string;
  /** One city's rate, standing in for every city's there; null for every city. */
  readonly city: string | null;
  readonly kind: VisitPayKind;
  /** Paise; null from this date for no rate of its own. */
  readonly amount: number | null;
  readonly effective_from: string;
  readonly set_by: string;
  readonly set_at: string;
}

export interface TechnicianPay {
  readonly grades: PayGrade[];
  readonly technicians: PayTechnician[];
  /** The rates in force on `today`, and every one set to start later. */
  readonly rates: PayRate[];
}

const RATE_COLUMNS = "grade_id, city, visit_kind AS kind, amount, effective_from, set_by, set_at";

export async function technicianPay(db: D1Database, today: string): Promise<TechnicianPay> {
  const [grades, technicians, rates] = await db.batch([
    db.prepare(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM technicians t WHERE t.pay_grade_id = g.id AND t.active = 1) AS technicians
       FROM pay_grades g ORDER BY g.name`,
    ),
    db.prepare(
      "SELECT id, name, city, pay_grade_id AS grade_id FROM technicians WHERE active = 1 AND test_record = 0 ORDER BY name",
    ),
    db
      .prepare(
        `SELECT ${RATE_COLUMNS} FROM (
           SELECT r.*, row_number() OVER (
             PARTITION BY grade_id, coalesce(city, ''), visit_kind ORDER BY effective_from DESC) AS latest
           FROM visit_pay_rates r WHERE effective_from <= ?1)
         WHERE latest = 1 AND amount IS NOT NULL
         UNION ALL
         SELECT ${RATE_COLUMNS} FROM visit_pay_rates WHERE effective_from > ?1
         ORDER BY grade_id, city, kind, effective_from`,
      )
      .bind(today),
  ]);
  return {
    grades: (grades?.results ?? []) as PayGrade[],
    technicians: (technicians?.results ?? []) as PayTechnician[],
    rates: (rates?.results ?? []) as PayRate[],
  };
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

const nameTaken = async (db: D1Database, name: string, except: string | null): Promise<boolean> =>
  (await db
    .prepare("SELECT 1 FROM pay_grades WHERE lower(name) = lower(?1) AND id IS NOT ?2")
    .bind(name, except)
    .first()) !== null;

const gradeExists = async (db: D1Database, id: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 FROM pay_grades WHERE id = ?1").bind(id).first()) !== null;

export async function addGrade(db: D1Database, change: Change & { readonly name: string }): Promise<"taken" | "added"> {
  if (await nameTaken(db, change.name, null)) return "taken";
  const id = crypto.randomUUID();
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO pay_grades (id, name, created_by, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, change.name, change.actor.id, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "pay_grade.add",
        subject: { kind: "pay_grade", id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return "added";
}

export async function renameGrade(
  db: D1Database,
  change: Change & { readonly id: string; readonly name: string },
): Promise<"not_found" | "taken" | "renamed"> {
  if (!(await gradeExists(db, change.id))) return "not_found";
  if (await nameTaken(db, change.name, change.id)) return "taken";
  await db.batch([
    db.prepare("UPDATE pay_grades SET name = ?2 WHERE id = ?1").bind(change.id, change.name),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "pay_grade.rename",
        subject: { kind: "pay_grade", id: change.id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return "renamed";
}

/** Deletes a grade added by mistake: one no technician holds and no rate has ever named. */
export async function deleteGrade(
  db: D1Database,
  change: Change & { readonly id: string },
): Promise<"not_found" | "in_use" | "deleted"> {
  if (!(await gradeExists(db, change.id))) return "not_found";
  const used = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM technicians WHERE pay_grade_id = ?1)
         OR EXISTS (SELECT 1 FROM visit_pay_rates WHERE grade_id = ?1) AS used`,
    )
    .bind(change.id)
    .first<{ used: number }>();
  if (used?.used === 1) return "in_use";
  await db.batch([
    db.prepare("DELETE FROM pay_grades WHERE id = ?1").bind(change.id),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "pay_grade.delete",
        subject: { kind: "pay_grade", id: change.id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return "deleted";
}

interface RateChange extends Change {
  readonly gradeId: string;
  readonly city: string | null;
  readonly kind: VisitPayKind;
  readonly amount: number | null;
  /** India's date, today or later: checked by the caller. */
  readonly from: string;
}

/** Sets a grade's rate for a kind of visit from a date, replacing one already set to start that day. */
export async function setRate(db: D1Database, change: RateChange): Promise<"not_found" | "set"> {
  if (!(await gradeExists(db, change.gradeId))) return "not_found";
  await db.batch([
    db
      .prepare(
        `DELETE FROM visit_pay_rates
         WHERE grade_id = ?1 AND coalesce(city, '') = coalesce(?2, '') AND visit_kind = ?3 AND effective_from = ?4`,
      )
      .bind(change.gradeId, change.city, change.kind, change.from),
    db
      .prepare(
        `INSERT INTO visit_pay_rates (id, grade_id, city, visit_kind, amount, effective_from, set_by, set_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        change.gradeId,
        change.city,
        change.kind,
        change.amount,
        change.from,
        change.actor.id,
        change.now.toISOString(),
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "pay_rate.set",
        subject: { kind: "pay_grade", id: change.gradeId },
        requestId: change.requestId,
        detail: { city: change.city, kind: change.kind, amount: change.amount, from: change.from },
      },
      change.now,
    ),
  ]);
  return "set";
}

/** Gives a technician a grade, or takes theirs away. */
export async function setTechnicianGrade(
  db: D1Database,
  change: Change & { readonly technicianId: string; readonly gradeId: string | null },
): Promise<"not_found" | "set"> {
  const technician = await db
    .prepare("SELECT pay_grade_id AS grade FROM technicians WHERE id = ?1")
    .bind(change.technicianId)
    .first<{ grade: string | null }>();
  if (technician === null) return "not_found";
  if (change.gradeId !== null && !(await gradeExists(db, change.gradeId))) return "not_found";
  await db.batch([
    db
      .prepare("UPDATE technicians SET pay_grade_id = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(change.technicianId, change.gradeId, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "technician.pay_grade",
        subject: { kind: "technician", id: change.technicianId },
        requestId: change.requestId,
        detail: { grade: change.gradeId, was: technician.grade },
      },
      change.now,
    ),
  ]);
  return "set";
}
