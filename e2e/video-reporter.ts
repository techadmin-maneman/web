// Every test's video, filed for an audit (npm run e2e:videos): by who uses the surface, the client, the technician or
// a member of staff, then by department for staff, the spec and the test, with an index of them all. A console spec is
// its department's (docs/decisions/0109-console-departments-and-access.md); a test may name another with a "role"
// annotation.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/** Where the videos are filed, beside test-results/ and as git-ignored. */
const VIDEOS = "videos";

/** The department each console spec works in; any other is Operations'. */
const DEPARTMENT: Readonly<Record<string, string>> = {
  "client-list": "Customer Care",
  clients: "Customer Care",
  "clients-consents": "Customer Care",
  "clients-invites-photos": "Customer Care",
  "clients-page": "Customer Care",
  "clients-visits": "Customer Care",
  deletions: "Customer Care",
  grievances: "Customer Care",
  "number-changes": "Customer Care",
  "clients-money": "Finance",
  "no-shows": "Finance",
  "no-shows-cases": "Finance",
  "partner-commission": "Finance",
  "settings-discount-codes": "Finance",
  spend: "Finance",
  "technician-pay": "Finance",
  cities: "Growth",
  launch: "Growth",
  partners: "Growth",
  referrals: "Growth",
  "settings-areas": "Growth",
  waitlist: "Growth",
  consumables: "Admin",
  "job-sheet": "Admin",
  settings: "Admin",
  "settings-services": "Admin",
  staff: "Admin",
  words: "Admin",
};

/** Who each project's surface is used by. */
const WHO: Readonly<Record<string, string>> = {
  "390": "customer",
  "1440": "customer",
  app: "customer",
  tech: "technician",
  "tech-live": "technician",
  "tech-ios": "technician",
  ops: "staff",
};

/** A file name of a test's title: lower case, words joined by dashes, short enough for any disk. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

interface Filed {
  readonly who: string;
  readonly role: string | null;
  readonly spec: string;
  readonly title: string;
  readonly project: string;
  readonly outcome: string;
  readonly file: string;
}

export default class VideoReporter implements Reporter {
  private readonly filed: Filed[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const video = result.attachments.find((attachment) => attachment.name === "video" && attachment.path !== undefined);
    if (video?.path === undefined) return;
    const project = test.parent.project()?.name ?? "unknown";
    const who = WHO[project] ?? "other";
    const spec = basename(test.location.file).replace(/\.e2e\.ts$/, "");
    const named = test.annotations.find((note) => note.type === "role")?.description;
    const role = who === "staff" ? (named ?? DEPARTMENT[spec] ?? "Operations") : null;
    const folder = join(VIDEOS, who, ...(role === null ? [] : [slug(role)]), spec);
    mkdirSync(folder, { recursive: true });
    const retry = result.retry === 0 ? "" : `-retry${String(result.retry)}`;
    const file = join(folder, `${slug(test.title)}-${project}${retry}.webm`);
    copyFileSync(video.path, file);
    this.filed.push({ who, role, spec, title: test.title, project, outcome: result.status, file });
  }

  onEnd(): void {
    if (this.filed.length === 0) return;
    const lines = this.filed
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((each) => {
        const who = each.role === null ? each.who : `${each.who}, ${each.role}`;
        const link = relative(VIDEOS, each.file).split(sep).join("/");
        return `| ${who} | ${each.spec} | ${each.title} | ${each.project} | ${each.outcome} | [video](${link}) |`;
      });
    const index = [
      "# Walkthrough videos",
      "",
      "| Who | Spec | Workflow | Width | Outcome | Video |",
      "| --- | --- | --- | --- | --- | --- |",
      ...lines,
      "",
    ].join("\n");
    writeFileSync(join(VIDEOS, "index.md"), index);
    console.log(`${String(this.filed.length)} videos filed in ${VIDEOS}/ (index.md lists them)`);
  }
}
