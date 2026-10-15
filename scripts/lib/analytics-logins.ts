// The analytics project's logins, from .env.analytics-supabase, which git ignores: the API's writer and Zoho's reader
// through Supabase's session pooler, and the project's postgres login, which only the migrations use. No password is
// printed.

import { readFileSync } from "node:fs";
import postgres from "postgres";
import type { Postgres } from "./warehouse-migrations.ts";

const POOLER = "aws-0-ap-south-1.pooler.supabase.com:5432";

function analyticsEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(".env.analytics-supabase", "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

const PASSWORDS = { analytics_writer: "ANALYTICS_WRITER_DB_PASSWORD", zoho_reader: "ZOHO_READER_DB_PASSWORD" } as const;

/** The pooler's connection string for one of the two roles the copy has. */
export function analyticsLogin(role: keyof typeof PASSWORDS): string {
  const env = analyticsEnv();
  const password = env[PASSWORDS[role]];
  if (password === undefined || password === "") throw new Error(`.env.analytics-supabase has no ${PASSWORDS[role]}`);
  return `postgres://${role}.${String(env.ANALYTICS_PROJECT_REF)}:${encodeURIComponent(password)}@${POOLER}/postgres?sslmode=require`;
}

/** The postgres login's connection string, which Supabase's Connect panel gives as its session pooler's. */
export function adminLogin(): string {
  const url = analyticsEnv().WAREHOUSE_ADMIN_URL;
  if (url === undefined || url === "") {
    throw new Error(
      ".env.analytics-supabase has no WAREHOUSE_ADMIN_URL: copy the session pooler's string from Supabase",
    );
  }
  return url;
}

/** A connection the migrations can run on; `close` ends it. */
export function postgresAt(connectionString: string): Postgres & { readonly close: () => Promise<void> } {
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => undefined });
  const over = (client: Pick<postgres.Sql, "unsafe">): Postgres => ({
    exec: async (text) => {
      await client.unsafe(text);
    },
    query: async <T>(text: string, params: readonly (string | number | boolean | null)[] = []) =>
      (await client.unsafe(text, [...params])) as unknown as T[],
    transaction: async (work) => {
      if (client !== sql) throw new Error("a transaction inside a transaction");
      await sql.begin((tx) => work(over(tx)));
    },
  });
  return { ...over(sql), close: () => sql.end({ timeout: 5 }) };
}
