// Which high or critical advisories in `npm audit --json` fail CI. An advisory is let through only when it is listed
// in ALLOWED with the reason it cannot reach a user, and only until its review date: past that date it fails again,
// so someone looks for a fixed release.
//
// It imports nothing from node_modules.

export interface Allowance {
  readonly advisory: string;
  readonly reason: string;
  /** The last day (YYYY-MM-DD, UTC) the advisory is let through. */
  readonly until: string;
}

export const ALLOWED: readonly Allowance[] = [
  {
    advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    reason: "braces, inside knip (the dead-code check), runs only in development and CI; no fixed release yet",
    until: "2026-11-03",
  },
  {
    advisory: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp",
    reason:
      "http-cache-semantics, inside astro, caches remote images during the static build only; no fixed release yet",
    until: "2026-11-03",
  },
];

export interface AuditReport {
  vulnerabilities?: Record<string, { via: readonly (string | { url: string; severity: string; title: string })[] }>;
}

/** The advisories that fail the check, each as "package: title (url)". */
export function failingAdvisories(
  report: AuditReport,
  today: string,
  allowed: readonly Allowance[] = ALLOWED,
): string[] {
  const letThrough = new Set(allowed.filter((a) => a.until >= today).map((a) => a.advisory));
  const failing = new Set<string>();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via) {
      if (typeof via === "string") continue;
      if (via.severity !== "high" && via.severity !== "critical") continue;
      if (letThrough.has(via.url)) continue;
      failing.add(`${name}: ${via.title} (${via.url})`);
    }
  }
  return [...failing].sort();
}
