// The OpenAPI document and docs/api.md are generated from the zod route
// schemas, never written by hand. scripts/build/generate-openapi.ts writes them; the
// contract test fails when a committed copy is stale.

import { createApp } from "./app.ts";
import { SURFACE_HOSTS, type Surface } from "./config/environments.ts";
import type { StaticConfig } from "./guard.ts";

/** Only the routes are read from this app, so its settings are placeholders. */
const DOCUMENTATION_CONFIG: StaticConfig = {
  environment: "local",
  providers: {
    IMAGE_PROVIDER: "stub",
    CRM_PROVIDER: "stub",
    MESSAGING_PROVIDER: "stub",
    ACCESS_PROVIDER: "stub",
    SMS_PROVIDER: "stub",
    BOOKS_PROVIDER: "stub",
    PAYMENTS_PROVIDER: "stub",
    GEOCODE_PROVIDER: "stub",
  },
  settings: {
    leadMobileDailyLimit: 5,
    leadIpDailyLimit: 20,
    turnstileSecret: "",
    acceptTurnstileTestToken: false,
    selfServeBooking: false,
    referrerNameOnInvite: false,
    ipHashSalt: "",
    alertWebhookUrl: null,
    leadWebhookUrl: null,
    heartbeatUrl: null,
    sentryDsn: null,
    zohoCrm: null,
    zohoBooks: null,
    razorpay: null,
    geocode: { apiKey: null, dailyCeiling: 0 },
    access: null,
    login: {
      codePepper: "",
      codeMobileDailyLimit: 0,
      codeIpHourlyLimit: 0,
      codeDailyCeiling: 0,
      techCodeDailyCeiling: 0,
      fixedCode: null,
      testRecordCode: null,
    },
    tryon: {
      uploadIpHourlyLimit: 0,
      generateIpHourlyLimit: 0,
      claimMobileDailyLimit: 0,
      resultMessageMobileDailyLimit: 0,
      renderDailyCeiling: 0,
      uploadDailyCeiling: 0,
      resultReadDailyCeiling: 0,
      resultRetentionDays: 30,
      creditFloor: 0,
      linkSigningKey: "",
      ailabApiKey: null,
    },
    messaging: { enabled: false, allowlist: [], evolution: null },
    devRoutes: false,
  },
};

/** The surfaces with routes of their own to document, and where each document is written. */
export const DOCUMENTED_SURFACES = {
  public: { json: "docs/openapi.json", markdown: "docs/api.md" },
  client: { json: "docs/openapi-client.json", markdown: "docs/api-client.md" },
  ops: { json: "docs/openapi-ops.json", markdown: "docs/api-ops.md" },
  tech: { json: "docs/openapi-tech.json", markdown: "docs/api-tech.md" },
} as const satisfies Partial<Record<Surface, { json: string; markdown: string }>>;
export type DocumentedSurface = keyof typeof DOCUMENTED_SURFACES;

const INFO: Readonly<Record<DocumentedSurface, { title: string; description: string }>> = {
  public: {
    title: "Mane Man API",
    description: "mm-api, served at https://{host}/api/*. Every response carries an X-Request-Id header.",
  },
  client: {
    title: "Mane Man API: the client app",
    description:
      "mm-api on the client app's host (docs/decisions/0026-hosts-and-surfaces.md), served at https://{host}/api/*. " +
      "Every route but /api/health and /api/auth/* needs the mm_app session cookie, and every write needs the page's own Origin. " +
      "Every response carries an X-Request-Id header.",
  },
  ops: {
    title: "Mane Man API: the ops console",
    description:
      "mm-api on the ops console's host (docs/decisions/0026-hosts-and-surfaces.md), served at https://{host}/api/*, behind Cloudflare Access. " +
      "Every call needs a valid Access token and is recorded in the audit log under its identity (docs/decisions/0031-access-and-audit.md). " +
      "Every response carries an X-Request-Id header.",
  },
  tech: {
    title: "Mane Man API: the technician app",
    description:
      "mm-api on the technician app's host (docs/decisions/0026-hosts-and-surfaces.md), served at https://{host}/api/*. " +
      "Every route but /api/health and /api/tech/auth/* needs the mm_tech session cookie, which is bound to one phone, and every write needs the page's own Origin. " +
      "Every write also takes an X-Client-Event-Id and is idempotent on it, so a phone replaying its outbox lands each write once (docs/decisions/0038-offline-writes.md). " +
      "No response here carries an amount. Every response carries an X-Request-Id header.",
  },
};

export type OpenApiDocument = ReturnType<ReturnType<typeof createApp>["getOpenAPI31Document"]>;

export function buildOpenApiDocument(surface: DocumentedSurface = "public"): OpenApiDocument {
  const app = createApp(DOCUMENTATION_CONFIG, undefined, surface);
  const document = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { version: "1", ...INFO[surface] },
    servers: [
      { url: `https://${SURFACE_HOSTS.production[surface]}`, description: "production" },
      { url: `https://${SURFACE_HOSTS.staging[surface]}`, description: "staging (Cloudflare Access)" },
    ],
  });
  mergeExtendedSchemas(document.components?.schemas ?? {});
  return document;
}

interface ObjectSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: unknown;
}

function isObjectSchema(schema: unknown): schema is ObjectSchema {
  return property(schema, "type") === "object" && typeof property(schema, "properties") === "object";
}

/**
 * A registered schema's .extend() is written as `allOf: [the base, what it adds]`, and each part is closed with
 * `additionalProperties: false`, so each refuses the other's fields and no real answer could ever validate. Each
 * such component is written instead as the one closed object it means.
 */
function mergeExtendedSchemas(schemas: Record<string, unknown>): void {
  const resolve = (part: unknown): unknown => {
    const ref = property(part, "$ref");
    return typeof ref === "string" ? schemas[ref.replace("#/components/schemas/", "")] : part;
  };
  for (const [name, schema] of Object.entries(schemas)) {
    const allOf = property(schema, "allOf");
    if (!Array.isArray(allOf)) continue;
    const parts = allOf.map(resolve);
    if (!parts.every(isObjectSchema)) continue;
    const annotations = Object.entries(schema as object).filter(([key]) => key !== "allOf");
    const closed = parts.some((part) => part.additionalProperties === false);
    schemas[name] = {
      ...Object.fromEntries(annotations),
      type: "object",
      properties: Object.assign({}, ...parts.map((part) => part.properties)) as Record<string, unknown>,
      required: [...new Set(parts.flatMap((part) => part.required ?? []))],
      ...(closed ? { additionalProperties: false } : {}),
    };
  }
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface DocumentedResponse {
  readonly description: string;
  readonly jsonSchema: unknown;
}

/** `value[key]` if `value` is an object that has `key`, otherwise undefined. */
function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** The OpenAPI types describe responses loosely, so read one without trusting its shape. */
export function readResponse(response: unknown): DocumentedResponse {
  const description = property(response, "description");
  const jsonSchema = property(property(property(response, "content"), "application/json"), "schema");
  return { description: typeof description === "string" ? description : "", jsonSchema };
}

const json = (value: unknown): string => ["```json", JSON.stringify(value, null, 2), "```"].join("\n");

export function renderApiMarkdown(document: OpenApiDocument): string {
  const out: string[] = [
    "<!-- Generated by `npm run openapi` from the zod schemas in src/. Do not edit. -->",
    "",
    `# ${document.info.title}`,
    "",
    document.info.description ?? "",
    "",
    "Errors carry a stable code and the request ID, never a stack trace or provider message:",
    "",
    json({ error: { code: "not_found", request_id: "…" } }),
    "",
    "## Endpoints",
    "",
  ];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      out.push(`### ${method.toUpperCase()} ${path}`, "", operation.summary ?? "", "");
      const body = operation.requestBody;
      if (body !== undefined && "content" in body) {
        out.push("Request body:", "", json(body.content["application/json"]?.schema ?? {}), "");
      }
      for (const [status, raw] of Object.entries(operation.responses ?? {}) as [string, unknown][]) {
        const response = readResponse(raw);
        out.push(`**${status}**: ${response.description}`, "");
        if (response.jsonSchema !== undefined) out.push(json(response.jsonSchema), "");
      }
    }
  }
  out.push("## Schemas", "");
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    out.push(`### ${name}`, "", json(schema), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
