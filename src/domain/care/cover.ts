// The Care team's days off and who covers them (docs/decisions/0134-care-cover.md): each member's weekly days off and
// leave as a Customer Care manager sets them, and on any day, the member covering each one who is off
// (src/policy/care-cover.ts). Each change is audited.

import { coversOf, isOff, type OffDays } from "../../policy/care-cover.ts";
import { auditStatement, type AuditAction, type AuditActor } from "../ops/audit.ts";
import { careTeam } from "./care-people.ts";

export interface Leave {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface RotaMember {
  readonly email: string;
  /** The first name clients know them by; null until a manager sets it. */
  readonly name: string | null;
  readonly clients: number;
  /** 0 Sunday to 6 Saturday. */
  readonly weekly_off: number[];
  /** Leave that has not ended, the soonest first. */
  readonly leave: Leave[];
  /** Who covers them today; null while they are on, or the whole team is off. */
  readonly covered_by: string | null;
  readonly off_today: boolean;
}

/** The team as it stands on an India date: each member's days off, and who covers whom. */
export async function careRota(db: D1Database, today: string): Promise<RotaMember[]> {
  const [team, rows] = await Promise.all([
    careTeam(db),
    db.batch([
      db.prepare("SELECT email, weekday FROM care_weekly_off ORDER BY weekday"),
      db.prepare("SELECT email, name FROM care_names"),
      db
        .prepare("SELECT id, email, from_date, to_date FROM care_leave WHERE to_date >= ?1 ORDER BY from_date")
        .bind(today),
    ]),
  ]);
  const weekly = (rows[0]?.results ?? []) as { email: string; weekday: number }[];
  const names = (rows[1]?.results ?? []) as { email: string; name: string }[];
  const leave = (rows[2]?.results ?? []) as { id: string; email: string; from_date: string; to_date: string }[];
  const offOf = (email: string): OffDays => ({
    weekly: weekly.filter((row) => row.email === email).map((row) => row.weekday),
    leave: leave.filter((row) => row.email === email).map((row) => ({ from: row.from_date, to: row.to_date })),
  });
  const off = new Set(team.filter((member) => isOff(today, offOf(member.email))).map((member) => member.email));
  const covers = coversOf(team, off);
  return team.map((member) => ({
    email: member.email,
    name: names.find((row) => row.email === member.email)?.name ?? null,
    clients: member.clients,
    weekly_off: [...offOf(member.email).weekly],
    leave: leave
      .filter((row) => row.email === member.email)
      .map((row) => ({ id: row.id, from: row.from_date, to: row.to_date })),
    covered_by: covers.get(member.email) ?? null,
    off_today: off.has(member.email),
  }));
}

/** On an India date, the member covering each one who is off. */
export async function coverOn(db: D1Database, today: string): Promise<ReadonlyMap<string, string>> {
  const rota = await careRota(db, today);
  return new Map(rota.flatMap((member) => (member.covered_by === null ? [] : [[member.email, member.covered_by]])));
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** The audit entry for a change to a member's days off. */
const audited = (
  db: D1Database,
  change: Change,
  entry: {
    readonly action: AuditAction;
    readonly email: string;
    readonly detail: Readonly<Record<string, string | number | boolean | null>>;
  },
) =>
  auditStatement(
    db,
    {
      surface: "ops",
      actor: change.actor,
      action: entry.action,
      subject: { kind: "staff", id: entry.email },
      requestId: change.requestId,
      detail: entry.detail,
    },
    change.now,
  );

/** A member's weekly days off, replaced whole. */
export async function setWeeklyOff(
  db: D1Database,
  change: Change & { readonly email: string; readonly weekdays: readonly number[] },
): Promise<void> {
  const at = change.now.toISOString();
  await db.batch([
    db.prepare("DELETE FROM care_weekly_off WHERE email = ?1").bind(change.email),
    ...change.weekdays.map((weekday) =>
      db
        .prepare("INSERT INTO care_weekly_off (email, weekday, set_by, set_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(change.email, weekday, change.actor.id, at),
    ),
    audited(db, change, {
      action: "care_rota.set",
      email: change.email,
      detail: { weekdays: change.weekdays.join(",") },
    }),
  ]);
}

/** Leave for a member, from one India date to another, both included. */
export async function addLeave(
  db: D1Database,
  change: Change & { readonly email: string; readonly from: string; readonly to: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO care_leave (id, email, from_date, to_date, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, change.email, change.from, change.to, change.actor.id, change.now.toISOString()),
    audited(db, change, {
      action: "care_leave.add",
      email: change.email,
      detail: { from: change.from, to: change.to },
    }),
  ]);
  return id;
}

/** Leave taken back; false for leave we do not have. */
export async function deleteLeave(db: D1Database, change: Change & { readonly id: string }): Promise<boolean> {
  const leave = await db
    .prepare("SELECT email, from_date, to_date FROM care_leave WHERE id = ?1")
    .bind(change.id)
    .first<{ email: string; from_date: string; to_date: string }>();
  if (leave === null) return false;
  await db.batch([
    db.prepare("DELETE FROM care_leave WHERE id = ?1").bind(change.id),
    audited(db, change, {
      action: "care_leave.delete",
      email: leave.email,
      detail: { from: leave.from_date, to: leave.to_date },
    }),
  ]);
  return true;
}
