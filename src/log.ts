// The only logger. Emits one JSON object per line (Workers Logs indexes the
// fields) and redacts personal data and secrets before anything is written.
//
// Redaction is by field name, case- and separator-insensitive (`mobile_e164`,
// `mobileE164` and `Mobile` are the same field), at any depth. As a second line
// of defence, e-mail addresses and Indian mobile numbers are masked inside
// every string value, so a provider error that echoes a number does not leak it.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export const REDACTED = "[redacted]";

/** Personal data: the person's identity and anything that locates their photos. */
const PERSONAL_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "full_name",
  "mobile",
  "mobile_e164",
  "phone",
  "email",
  "to",
  "ip",
  "upload_key",
  "result_key",
  "image_key",
  "object_key",
  "provider_result_url",
  "result_url",
  "signed_url",
] as const;

/** Credentials. */
const SECRET_FIELDS = [
  "authorization",
  "cookie",
  "set_cookie",
  "api_key",
  "ailabapi_api_key",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "client_secret",
  "password",
  "signature",
] as const;

const normalise = (field: string): string => field.toLowerCase().replace(/[^a-z0-9]/g, "");

const REDACTED_FIELDS: ReadonlySet<string> = new Set([...PERSONAL_FIELDS, ...SECRET_FIELDS].map(normalise));

export function isRedactedField(field: string): boolean {
  return REDACTED_FIELDS.has(normalise(field));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// +91 / 91 / 0 prefixes, optional separators, then a ten-digit Indian mobile.
const INDIAN_MOBILE = /(?<![\d])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d])/g;

export function scrubString(value: string): string {
  return value.replace(EMAIL, REDACTED).replace(INDIAN_MOBILE, REDACTED);
}

const MAX_DEPTH = 8;

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      ...(value.stack === undefined ? {} : { stack: scrubString(value.stack) }),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    out[field] = isRedactedField(field) ? REDACTED : redact(fieldValue, depth + 1, seen);
  }
  return out;
}

const WRITERS: Readonly<Record<LogLevel, (line: string) => void>> = {
  debug: (line) => {
    console.debug(line);
  },
  info: (line) => {
    console.log(line);
  },
  warn: (line) => {
    console.warn(line);
  },
  error: (line) => {
    console.error(line);
  },
};

export function createLogger(base: LogFields = {}): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const record = redact({ ...base, ...fields }) as Record<string, unknown>;
    WRITERS[level](JSON.stringify({ level, event, time: new Date().toISOString(), ...record }));
  };
  return {
    debug: (event, fields) => {
      write("debug", event, fields);
    },
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}
