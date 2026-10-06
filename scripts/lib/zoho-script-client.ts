// The one Zoho client the scripts use, for the CRM or Books: an access token minted once a run from the scripts' own
// refresh token (zoho-script-token.ts), and every answer read through a zod schema, so a script that writes or deletes
// in the real org never acts on a shape Zoho did not send.

import { z } from "zod";
import { refreshTokenForScript, type ZohoClient } from "./zoho-script-token.ts";

/** What each client's variables start with: its ID, its secret and its hosts. */
const PREFIXES: Readonly<Record<ZohoClient, string>> = { books: "ZOHO_BOOKS_", crm: "ZOHO_" };

/** What the accounts host answers a refresh with: a token, or why not. */
const MINTED = z.looseObject({ access_token: z.string().optional(), error: z.string().optional() });

/** The variable, or the script stops with which one is missing. */
export function requiredEnv(name: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets file with --env-file`);
    process.exit(2);
  }
  return value;
}

export interface ZohoAnswer {
  readonly status: number;
  /** Null for an empty body: Zoho answers an empty list with 204. */
  readonly json: unknown;
}

export interface ZohoScriptClient {
  /** The API host the calls go to, for what a script reports. */
  readonly host: string;
  /**
   * One call. A CRM path is the whole path (`/crm/v8/Leads`); a Books path is below `/books/v3`, and the organisation
   * is added to it.
   */
  call(method: string, path: string, body?: unknown): Promise<ZohoAnswer>;
  /** A GET whose answer must be the schema's shape; throws, naming the path and the status, when it is not. */
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
}

interface Seams {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly argv?: readonly string[];
  readonly fetch?: typeof fetch;
}

/** The client, with its access token minted; the script stops if Zoho refuses the refresh token. */
export async function zohoScriptClient(client: ZohoClient, seams: Seams = {}): Promise<ZohoScriptClient> {
  const env = seams.env ?? process.env;
  const send = seams.fetch ?? fetch;
  const prefix = PREFIXES[client];
  const host = requiredEnv(`${prefix}API_HOST`, env);
  const orgId = client === "books" ? requiredEnv("ZOHO_BOOKS_ORG_ID", env) : null;

  const query = new URLSearchParams({
    refresh_token: refreshTokenForScript(client, env, seams.argv),
    client_id: requiredEnv(`${prefix}CLIENT_ID`, env),
    client_secret: requiredEnv(`${prefix}CLIENT_SECRET`, env),
    grant_type: "refresh_token",
  });
  const accounts = requiredEnv(`${prefix}ACCOUNTS_HOST`, env);
  const minted = await send(`https://${accounts}/oauth/v2/token?${query.toString()}`, { method: "POST" });
  const { access_token: token, error } = MINTED.parse(await minted.json());
  if (token === undefined) {
    console.error(`FAIL  token: Zoho refused the ${client} refresh token (${error ?? String(minted.status)})`);
    process.exit(1);
  }

  const urlOf = (path: string) => {
    if (orgId === null) return `https://${host}${path}`;
    return `https://${host}/books/v3${path}${path.includes("?") ? "&" : "?"}organization_id=${orgId}`;
  };

  const call = async (method: string, path: string, body?: unknown): Promise<ZohoAnswer> => {
    const response = await send(urlOf(path), {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
  };

  const get = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const answer = await call("GET", path);
    const parsed = schema.safeParse(answer.json);
    if (parsed.success) return parsed.data;
    const where = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new Error(`${path} answered ${String(answer.status)} in a shape the script does not know (${where})`);
  };

  return { host, call, get };
}
