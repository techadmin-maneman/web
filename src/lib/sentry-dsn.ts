// A Sentry project's DSN, as the settings read it and the error tracker sends to it (src/providers/error-tracking.ts).

/** A Sentry DSN taken apart: where events go, and the public key that sends them. */
export interface SentryDsn {
  readonly raw: string;
  readonly envelopeUrl: string;
}

/** `https://<key>@<host>/<project>`, or null when it is not one. */
export function parseDsn(dsn: string): SentryDsn | null {
  const match = /^https:\/\/([0-9a-f]+)@([a-z0-9.-]+)\/(\d+)$/i.exec(dsn.trim());
  if (match === null) return null;
  const [, key = "", host = "", project = ""] = match;
  return {
    raw: dsn.trim(),
    envelopeUrl: `https://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`,
  };
}
