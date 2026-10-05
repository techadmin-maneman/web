// The Staff list as a test sets it up (migrations/0069_staff_and_access.sql): people and their grants, service tokens,
// and the switch. Every address and ID is made up.

import { env } from "cloudflare:workers";
import type { App } from "../../../src/http/context.ts";
import type { AccessIdentity } from "../../../src/providers/cloudflare-access.ts";
import { appFor, fakeDependencies, NOW } from "../helpers.ts";

/** "finance:view:city:Delhi", "admin:manage:national". */
export type GrantCode = `${string}:${string}:${string}`;

/** The ops console, called as this identity, as Access would name it. */
export function opsAs(identity: AccessIdentity): App {
  const access = { verify: () => Promise.resolve({ ok: true as const, identity }) };
  return appFor("local", fakeDependencies({ access }), {}, "ops");
}

export const person = (email: string): AccessIdentity => ({ kind: "staff", email });
export const token = (clientId: string): AccessIdentity => ({ kind: "service", clientId });

export async function listStaff(email: string, grants: readonly GrantCode[], active = true): Promise<void> {
  const at = NOW.toISOString();
  await env.DB.prepare("INSERT INTO staff (email, active, added_by, added_at) VALUES (?1, ?2, 'test', ?3)")
    .bind(email, active ? 1 : 0, at)
    .run();
  for (const code of grants) {
    const [department, level, geography, place = null] = code.split(":");
    await env.DB.prepare(
      `INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'test', ?6)`,
    )
      .bind(email, department, level, geography, place, at)
      .run();
  }
}

export async function allowToken(clientId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO staff_service_tokens (client_id, label, added_by, added_at) VALUES (?1, 'CI', 'test', ?2)",
  )
    .bind(clientId, NOW.toISOString())
    .run();
}

export async function enforce(): Promise<void> {
  await env.DB.prepare("UPDATE staff_access_mode SET enforced = 1 WHERE id = 1").run();
}

export const post = (app: App, path: string, body: unknown) =>
  Promise.resolve(
    app.request(
      `https://maneman.test${path}`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    ),
  );
