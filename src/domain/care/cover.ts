// The Care team's shifts, days off and who covers them (docs/decisions/0134-care-cover.md, 0139-care-shifts.md): each
// member on or off shift as they mark it, their weekly days off and leave as a Customer Care manager sets them, and the
// member covering each one who is off (src/policy/care-cover.ts). Each change to days off is audited.

import { coversOf, isOff, type OffDays } from "../../policy/care-cover.ts";
import { auditStatement, type AuditAction, type AuditActor } from "../platform/audit.ts";
import { careTeam } from "./care-people.ts";
import { read, readAll } from "../../lib/read-all.ts";

interface Leave {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface RotaMember {
  readonly email: string;
  /** False for someone no longer on the Care team who still has clients, to be moved. */
  readonly on_team: boolean;
  /** The first name clients know them by; null until a manager sets it. */
  readonly name: string | null;
  readonly clients: number;
  /** 0 Sunday to 6 Saturday. */
  readonly weekly_off: number[];
  /** Leave that has not ended, the soonest first. */
  readonly leave: Leave[];
  /** Who covers them today; null while they are on, or the whole team is off. */
  readonly covered_by: string | null;
  /** Not answering now: off shift, or on a day off or leave. */
  readonly off_today: boolean;
  /** When they went on shift; null while off shift. */
  readonly on_shift_since: string | null;
  /** A weekly day off or leave today. */
  readonly day_off: boolean;
  /** Their clients' chats open now. */
  readonly open_chats: number;
}

/** The team as it stands on an India date: each member's days off, and who covers whom. */
export async function careRota(db: D1Database, today: string): Promise<RotaMember[]> {
  const [team, rows] = await Promise.all([
    careTeam(db),
    readAll(db, {
      weekly: read<{ email: string; weekday: number }>(
        db.prepare("SELECT email, weekday FROM care_weekly_off ORDER BY weekday"),
      ),
      names: read<{ email: string; name: string }>(db.prepare("SELECT email, name FROM care_names")),
      owners: read<{ email: string; clients: number }>(
        db.prepare("SELECT email, COUNT(*) AS clients FROM care_owners GROUP BY email"),
      ),
      shifts: read<{ email: string; on_shift_since: string }>(
        db.prepare("SELECT email, on_shift_since FROM staff WHERE on_shift_since IS NOT NULL"),
      ),
      open: read<{ email: string; n: number }>(
        db.prepare(
          `SELECT o.email, COUNT(*) AS n FROM conversations c JOIN care_owners o ON o.person_id = c.person_id
           WHERE c.state = 'open' GROUP BY o.email`,
        ),
      ),
      leave: read<{ id: string; email: string; from_date: string; to_date: string }>(
        db
          .prepare("SELECT id, email, from_date, to_date FROM care_leave WHERE to_date >= ?1 ORDER BY from_date")
          .bind(today),
      ),
    }),
  ]);
  const { weekly, names, owners, shifts, open, leave } = rows;
  const onShiftSince = (email: string) => shifts.find((row) => row.email === email)?.on_shift_since ?? null;
  const openChats = (email: string) => open.find((row) => row.email === email)?.n ?? 0;
  const offOf = (email: string): OffDays => ({
    weekly: weekly.filter((row) => row.email === email).map((row) => row.weekday),
    leave: leave.filter((row) => row.email === email).map((row) => ({ from: row.from_date, to: row.to_date })),
  });
  const dayOff = new Set(team.filter((member) => isOff(today, offOf(member.email))).map((member) => member.email));
  const off = new Set(
    team
      .filter((member) => dayOff.has(member.email) || onShiftSince(member.email) === null)
      .map((member) => member.email),
  );
  const covers = coversOf(
    team.map((member) => ({ email: member.email, load: openChats(member.email) })),
    off,
  );
  const left = owners.filter((owner) => !team.some((member) => member.email === owner.email));
  const members = team.map((member) => ({
    email: member.email,
    on_team: true,
    name: names.find((row) => row.email === member.email)?.name ?? null,
    clients: member.clients,
    weekly_off: [...offOf(member.email).weekly],
    leave: leave
      .filter((row) => row.email === member.email)
      .map((row) => ({ id: row.id, from: row.from_date, to: row.to_date })),
    covered_by: covers.get(member.email) ?? null,
    off_today: off.has(member.email),
    on_shift_since: onShiftSince(member.email),
    day_off: dayOff.has(member.email),
    open_chats: openChats(member.email),
  }));
  return [
    ...members,
    ...left.map((owner) => ({
      email: owner.email,
      on_team: false,
      name: names.find((row) => row.email === owner.email)?.name ?? null,
      clients: owner.clients,
      weekly_off: [],
      leave: [],
      covered_by: null,
      off_today: true,
      on_shift_since: null,
      day_off: false,
      open_chats: openChats(owner.email),
    })),
  ];
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

/** A member of the Care team on shift from now, or off it; their own to mark. */
export async function setOnShift(db: D1Database, email: string, on: boolean, now: Date): Promise<void> {
  await db
    .prepare("UPDATE staff SET on_shift_since = ?2 WHERE email = ?1")
    .bind(email, on ? now.toISOString() : null)
    .run();
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
