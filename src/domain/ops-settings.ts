// Reading and writing the business inputs ops set for themselves
// (migrations/0033_ops_settings.sql, docs/decisions/0061-ops-editable-inputs.md).
//
// ops_settings keeps a row per input, as the record of who set what and when.
// What the request path reads is one row beside it, ops_settings_snapshot,
// which migration 0054's triggers rewrite from those rows in the same
// transaction as every change to them. It is read once per isolate and held
// for SETTINGS_TTL_MS, so a change reaches every request within that window
// without a deploy, and a read costs one row however long the register grows
// (docs/decisions/0088-every-policy-in-the-console.md, ADR 0009).
//
// A row that is not there, and a store that cannot be read at all, both mean
// the committed default. The system runs on the numbers in the code until
// somebody sets one, and it never runs on a nought.

import {
  checkValue,
  OPS_SETTINGS,
  settingNamed,
  type OpsSetting,
  type OpsSettingName,
  type SettingValue,
} from "../config/ops-settings.ts";
import type { Cycles } from "../config/pieces.ts";
import type { PaymentHold } from "../config/scheduling.ts";
import type { NextVisitDays } from "../policy/next-visit.ts";
import type { Charges } from "../policy/moving-a-visit.ts";
import type { Waiver, Waits } from "../policy/no-show.ts";
import type { PhoneClock } from "../policy/phone-clock.ts";
import type { Slas } from "../policy/tasks.ts";
import type { TechnicianWorkFigures } from "../policy/technician-work.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { MINUTE_MS } from "../lib/durations.ts";

/** How long an isolate holds the store before reading it again. The staleness window. */
export const SETTINGS_TTL_MS = MINUTE_MS;

/** Every ops-set input, resolved: what the store holds, or the committed default. */
export interface OpsInputs {
  readonly checkinRadiusM: number;
  readonly noShowWaitMin: Waits;
  readonly phoneClock: PhoneClock;
  readonly changeNoticeHours: number;
  readonly lateChangeCharges: Charges;
  readonly noShowCharges: Charges;
  readonly noShowWaiver: Waiver;
  readonly addressUnlockHour: number;
  readonly reminderHour: number;
  readonly taskSlaHours: Slas;
  readonly pieceCycleDays: Cycles;
  readonly nextVisitDays: NextVisitDays;
  readonly paymentHold: PaymentHold;
  readonly technicianWork: TechnicianWorkFigures;
}

/** What one input is at this moment, and whether anybody set it. */
export interface SettingState {
  readonly setting: OpsSetting;
  readonly value: SettingValue;
  /** Null while the committed default is in force. */
  readonly setBy: string | null;
  readonly setAt: string | null;
}

type Row = { name: string; value: string; set_by: string; set_at: string };

const fallbacks = (): Readonly<Record<OpsSettingName, SettingValue>> =>
  Object.fromEntries(OPS_SETTINGS.map((setting) => [setting.name, setting.fallback])) as Record<
    OpsSettingName,
    SettingValue
  >;

/** The committed defaults, which are what runs while nothing is set. */
export const COMMITTED: OpsInputs = shape(fallbacks());

/** The register's names against the fields the code reads them by. */
function shape(values: Readonly<Record<OpsSettingName, SettingValue>>): OpsInputs {
  return {
    checkinRadiusM: values.checkin_radius_m as number,
    noShowWaitMin: values.no_show_wait_min as Waits,
    phoneClock: values.phone_clock as PhoneClock,
    changeNoticeHours: values.change_notice_hours as number,
    lateChangeCharges: values.late_change_charge as Charges,
    noShowCharges: values.no_show_charge as Charges,
    noShowWaiver: values.no_show_waiver as Waiver,
    addressUnlockHour: values.address_unlock_hour as number,
    reminderHour: values.reminder_hour as number,
    taskSlaHours: values.task_sla_hours as Slas,
    pieceCycleDays: values.piece_cycle_days as Cycles,
    nextVisitDays: values.booking_days as NextVisitDays,
    paymentHold: values.payment_hold as PaymentHold,
    technicianWork: values.technician_work as TechnicianWorkFigures,
  };
}

/**
 * A stored figure, if the register still allows it. A name the register has
 * since dropped, malformed JSON, or a figure now outside its bounds are all
 * ignored in favour of the committed default: the store is edited by people,
 * and a row left behind by an earlier register must not decide anything.
 */
function storedValue(name: string, stored: unknown): { name: OpsSettingName; value: SettingValue } | null {
  const setting = settingNamed(name);
  if (setting === undefined) return null;
  const checked = checkValue(setting, withKeysAddedSince(setting, stored));
  return checked.ok ? { name: setting.name as OpsSettingName, value: checked.value } : null;
}

const parsedOrNull = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/**
 * A key the register has added to a closed set since the row was saved, such
 * as a new task group, takes its committed figure; the keys ops set keep theirs.
 */
function withKeysAddedSince(setting: OpsSetting, stored: unknown): unknown {
  if (setting.keys === null || setting.keys === "open" || typeof setting.fallback !== "object") return stored;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return stored;
  return { ...setting.fallback, ...stored };
}

/** The inputs a snapshot holds: its JSON object of each name with its value, the committed figure for the rest. */
function resolve(snapshot: string): OpsInputs {
  const values = fallbacks() as Record<OpsSettingName, SettingValue>;
  const stored = parsedOrNull(snapshot);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return shape(values);
  for (const [name, value] of Object.entries(stored)) {
    const accepted = storedValue(name, value);
    if (accepted !== null) values[accepted.name] = accepted.value;
  }
  return shape(values);
}

export type ReadOpsInputs = (db: D1Database, now: Date, onError?: (error: unknown) => void) => Promise<OpsInputs>;

const ROWS = "SELECT name, value, set_by, set_at FROM ops_settings";
const SNAPSHOT = "SELECT inputs FROM ops_settings_snapshot WHERE id = 1";
/** Migration 0054's triggers run the same statement after every change to ops_settings. */
const REBUILD = `INSERT OR REPLACE INTO ops_settings_snapshot (id, inputs)
  SELECT 1, json_group_object(name, json(value)) FROM ops_settings RETURNING inputs`;

/** The snapshot as it stands, built again from the rows if it has gone missing. */
async function snapshot(db: D1Database): Promise<string> {
  const held = await db.prepare(SNAPSHOT).first<{ inputs: string }>();
  if (held !== null) return held.inputs;
  const rebuilt = await db.prepare(REBUILD).first<{ inputs: string }>();
  return rebuilt?.inputs ?? "{}";
}

/**
 * The store as it is now, straight from D1. For a queue consumer or a
 * scheduled pass, which runs once a message and has no isolate worth caching
 * in; a route uses createCachedOpsInputs instead.
 */
export const readOpsInputs: ReadOpsInputs = async (db, _now, onError) => {
  try {
    return resolve(await snapshot(db));
  } catch (error) {
    onError?.(error);
    return COMMITTED;
  }
};

/**
 * The store, remembered for a minute at a time within one isolate. A failure
 * is never remembered as a value: the last good read stands if there is one,
 * and the committed defaults if there is not, so an unreachable store is a
 * stale number and never a missing one.
 */
export function createCachedOpsInputs(): ReadOpsInputs {
  let held: { readonly at: number; readonly inputs: OpsInputs } | undefined;
  return async (db, now, onError) => {
    const at = now.getTime();
    if (held !== undefined && at - held.at < SETTINGS_TTL_MS) return held.inputs;
    try {
      const inputs = resolve(await snapshot(db));
      held = { at, inputs };
      return inputs;
    } catch (error) {
      onError?.(error);
      return held?.inputs ?? COMMITTED;
    }
  };
}

/** Every input with what it is now and who set it, for the console's Rules panel. */
export async function settingStates(db: D1Database): Promise<SettingState[]> {
  const { results } = await db.prepare(ROWS).all<Row>();
  const rows = new Map(results.map((row) => [row.name, row]));
  return OPS_SETTINGS.map((setting) => {
    const row = rows.get(setting.name);
    const stored = row === undefined ? null : storedValue(row.name, parsedOrNull(row.value));
    if (row === undefined || stored === null) {
      return { setting, value: setting.fallback, setBy: null, setAt: null };
    }
    return { setting, value: stored.value, setBy: row.set_by, setAt: row.set_at };
  });
}

/**
 * Sets one input, or, with a null value, puts the committed default back. The
 * change and its audit entry go in one batch, so a change that is not recorded
 * does not happen (ADR 0031). `was` is read first only to record what it was.
 */
export async function setOpsSetting(
  db: D1Database,
  input: {
    readonly setting: OpsSetting;
    readonly value: SettingValue | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { setting, value, actor, requestId, now } = input;
  const states = await settingStates(db);
  const was = states.find((state) => state.setting.name === setting.name);
  const change =
    value === null
      ? db.prepare("DELETE FROM ops_settings WHERE name = ?1").bind(setting.name)
      : db
          .prepare(
            `INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (name) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at`,
          )
          .bind(setting.name, JSON.stringify(value), actor.id, now.toISOString());

  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "setting.change",
        subject: { kind: "setting", id: setting.name },
        requestId,
        detail: {
          from: JSON.stringify(was?.value ?? setting.fallback),
          to: value === null ? JSON.stringify(setting.fallback) : JSON.stringify(value),
          reset: value === null,
        },
      },
      now,
    ),
    change,
  ]);
}
