// What a page's content security policy refused, as the browser reports it (docs/decisions/0023-launch-hardening.md):
// a batch from the Reporting API (report-to, application/reports+json), or one report (report-uri,
// application/csp-report). Each refusal is one `csp_refused` log line: the directive, what it refused and the page's
// path, never its query. Nothing is stored. The hourly limits keep a page that refuses in a loop from flooding the
// logs, and a report bigger than any browser sends is let go unread.

import { createRoute } from "@hono/zod-openapi";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { visitorOf } from "../../http/visitor.ts";

/** Far past the few hundred bytes a report runs to. */
const MOST_BYTES = 16_384;

/** How many of a batch's reports are logged. */
const MOST_REPORTS = 10;

interface Refusal {
  readonly directive: string;
  readonly blocked: string;
  readonly page: string;
  /** "enforce", or "report" for the policy only reported on. */
  readonly disposition: string;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value.slice(0, 300) : "");

/** A page's address without its query or fragment, which may hold an invite's code or a link's token. */
function pathOf(address: string): string {
  try {
    const url = new URL(address);
    return `${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/** One refusal, from either shape's fields: the Reporting API's camelCase body, or report-uri's hyphenated one. */
function refusalOf(report: Record<string, unknown>): Refusal {
  const field = (camel: string, hyphen: string) => textOf(report[camel] ?? report[hyphen]);
  const blocked = field("blockedURL", "blocked-uri");
  return {
    directive: field("effectiveDirective", "effective-directive") || field("violatedDirective", "violated-directive"),
    // An inline script is reported as "inline"; any other address loses its query too.
    blocked: blocked.includes("://") ? pathOf(blocked) : blocked,
    page: pathOf(field("documentURL", "document-uri")),
    disposition: field("disposition", "disposition"),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The refusals a body holds: a batch's CSP reports, or report-uri's one. */
function refusalsIn(body: unknown): Refusal[] {
  if (Array.isArray(body)) {
    return body
      .filter((report): report is Record<string, unknown> => isRecord(report) && report.type === "csp-violation")
      .slice(0, MOST_REPORTS)
      .flatMap((report) => (isRecord(report.body) ? [refusalOf(report.body)] : []));
  }
  if (isRecord(body) && isRecord(body["csp-report"])) return [refusalOf(body["csp-report"])];
  return [];
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const reportRoute = createRoute({
  method: "post",
  path: "/api/csp-reports",
  summary: "Report what a page's content security policy refused",
  description:
    "A browser's own report, application/reports+json from report-to or application/csp-report from report-uri. " +
    "Anything else, or more than 16 KB, is let go unread.",
  responses: {
    204: { description: "Logged, or let go" },
    429: errorResponse("rate_limited: this address has sent its reports for the hour, or every address has"),
  },
});

export function registerCspReports(app: App): void {
  app.openapi(reportRoute, async (c) => {
    const length = Number(c.req.header("Content-Length") ?? "0");
    if (length > MOST_BYTES) return c.body(null, 204);
    const db = c.env.DB;
    const at = { now: c.var.deps.now(), settings: c.var.config.settings };
    const { ipHash } = await visitorOf(c);
    const within = (await takeOne(db, "csp_report:ip", ipHash, at)) && (await takeOne(db, "csp_report:all", "all", at));
    if (!within) return refuse(c, "rate_limited");

    const text = await c.req.text();
    if (text.length > MOST_BYTES) return c.body(null, 204);
    for (const refusal of refusalsIn(parsed(text))) {
      c.var.log.warn("csp_refused", { ...refusal, browser: c.req.header("User-Agent")?.slice(0, 200) });
    }
    return c.body(null, 204);
  });
}
