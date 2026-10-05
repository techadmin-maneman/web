// The production gate on Phase 2's copy. Where the design draws no words, each
// app's content file holds ours, marked PLACEHOLDER until the owner gives the
// wording (docs/open-points.md). Staging ships them by the owner's ruling
// (docs/decisions/0025-phase-2-conflicts-register.md, item 27); a production
// build stops while any remain, as the public site's does on its placeholder
// blocks (site/src/lib/publish-gate.ts). The referral landing is Phase 2 copy
// on the public site, so its content file is gated here too, with the site's own,
// whose marks wait on counsel. The API's copy, the job sheet's labels and the
// WhatsApp texts, is gated before a production release of mm-api
// (scripts/check-copy.ts).

import { readdirSync, readFileSync } from "node:fs";

/** A surface's copy written one file a feature, as the client app's and the console's are. */
const featureFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => `${dir}/${name}`);

/** The content files each production build is gated on. */
export const CONTENT_FILES = {
  site: ["site/src/content/referral.ts", "site/src/content/site.ts"],
  app: ["apps/app/src/content.ts", ...featureFiles("apps/app/src/content")],
  ops: ["apps/ops/src/content.ts", ...featureFiles("apps/ops/src/content")],
  tech: ["apps/tech/src/content.ts"],
  api: ["src/config/job-sheet.ts", "src/config/message-templates.ts"],
} as const;

export type ContentOwner = keyof typeof CONTENT_FILES;

const MARK = /\bPLACEHOLDER\b/;
/** How many of a file's marks the refusal lists by line. */
const LINES_SHOWN = 5;

/**
 * The line numbers of a content file's PLACEHOLDER marks. Its opening comment
 * explains the mark to the reader and is not one.
 */
export function placeholderMarks(source: string): number[] {
  const lines = source.split("\n");
  const afterOpeningComment = lines.findIndex((line) => !line.startsWith("//"));
  if (afterOpeningComment === -1) return [];

  const marks: number[] = [];
  lines.forEach((line, index) => {
    if (index >= afterOpeningComment && MARK.test(line)) marks.push(index + 1);
  });
  return marks;
}

/** One line for each file still marked. */
export function contentProblems(
  files: readonly string[],
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const marks = placeholderMarks(read(file));
    if (marks.length === 0) continue;
    const shown = marks.slice(0, LINES_SHOWN).join(", ");
    const more = marks.length > LINES_SHOWN ? ", …" : "";
    problems.push(`${file}: ${String(marks.length)} lines marked PLACEHOLDER, at ${shown}${more}`);
  }
  return problems;
}

export function assertPublishableContent(owner: ContentOwner): void {
  const problems = contentProblems(CONTENT_FILES[owner]);
  if (problems.length === 0) return;
  throw new Error(
    "The production build is blocked: this copy still waits for the owner's wording (docs/open-points.md)\n" +
      problems.map((problem) => `  - ${problem}`).join("\n"),
  );
}
