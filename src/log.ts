// The only logger. Writes one JSON object per line, which Workers Logs indexes
// field by field, and removes personal data and secrets before writing.
//
// Two layers of redaction:
// 1. By field name, at any depth. Names are compared without case or
//    separators, so `mobile_e164`, `mobileE164` and `Mobile_E164` all match.
// 2. Inside every string, e-mail addresses and Indian mobile numbers are
//    masked, so a provider error that repeats a number does not leak it.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line, e.g. the request ID. */
  child(fields: LogFields): Logger;
}

export const REDACTED = "[redacted]";

/** Who the person is, and anything that locates their photos. */
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
  "r2_key",
  // Where the person lives, and how a technician gets in.
  "line1",
  "line2",
  "locality",
  "access_notes",
  // An address's coordinates, and a phone's own, which locate a client's home
  // as surely as the street does (the technician app's check-in, P2-M4).
  "lat",
  "lng",
  "latitude",
  "longitude",
  "provider_result_url",
  "result_url",
  "signed_url",
  // Evolution's webhook bodies name the recipient's chat, and our own number.
  "remote_jid",
  "participant",
  "sender",
  "number",
];

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
  "webhook_token",
  // The signed path a technician's phone PUTs a photograph to (ADR 0028).
  "upload_url",
  // The webhook URL Evolution echoes back, which holds our webhook token.
  "destination",
];

/** "Mobile_E164" -> "mobilee164" */
function normaliseFieldName(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const REDACTED_FIELDS = new Set([...PERSONAL_FIELDS, ...SECRET_FIELDS].map(normaliseFieldName));

export function isRedactedField(field: string): boolean {
  return REDACTED_FIELDS.has(normaliseFieldName(field));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Matches "9876543210", "98765 43210", "+91 98765 43210", "91-9876543210" and
// "09876543210": an optional +91, 91 or 0, then ten digits starting 6-9. The
// (?<!\d) and (?!\d) stop it matching inside a longer number such as a timestamp.
const INDIAN_MOBILE = /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

// A UUID's last block is twelve hex characters, so about one in 270 is ten digits
// starting 6-9 and would be masked as a mobile number. An ID is never a number we
// are hiding, so a string that is exactly a UUID is left alone.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scrubString(value: string): string {
  if (UUID.test(value)) return value;
  return value.replace(EMAIL, REDACTED).replace(INDIAN_MOBILE, REDACTED);
}

/**
 * A caught failure's message, fit to keep in a column or put in an alert: with no e-mail or mobile number a vendor
 * echoed back, and no longer than `length`.
 */
export function failureReason(error: unknown, length = 300): string {
  return scrubString(error instanceof Error ? error.message : "unknown error").slice(0, length);
}

/** Returns a copy of `value` that is safe to log. */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}

const MAX_DEPTH = 8;

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    const error: Record<string, string> = { name: value.name, message: scrubString(value.message) };
    if (value.stack !== undefined) error.stack = scrubString(value.stack);
    return error;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  const copy: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    copy[field] = isRedactedField(field) ? REDACTED : redactValue(fieldValue, depth + 1, seen);
  }
  return copy;
}

// Workers Logs sets each line's level from the console method used.
const CONSOLE_METHOD = { debug: "debug", info: "log", warn: "warn", error: "error" } as const;

export function createLogger(baseFields: LogFields = {}): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const safeFields = redact({ ...baseFields, ...fields }) as Record<string, unknown>;
    const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...safeFields });
    console[CONSOLE_METHOD[level]](line);
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
    child: (fields) => createLogger({ ...baseFields, ...fields }),
  };
}
