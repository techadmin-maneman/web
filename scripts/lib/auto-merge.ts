// Whether a pull request merges itself once a CI run passes. A workflow asks this after every run of ci. A pull
// request merges when its branch is in this repository, the run that passed ran the full suite on its current head,
// and it is ready for review. One that touches money or personal data, or updates dependencies, also waits for the
// reviewed label, which a push takes off (.github/workflows/review-label.yml), and any pull request can be held by hand
// with the hold label.
//
// It imports nothing from node_modules: its job installs nothing.

import { FULL_SUITE_JOB } from "./already-checked.ts";

/** The label that keeps any pull request from merging itself, whatever it touches. */
export const HOLD_LABEL = "hold-for-review";

/** The label that says the pull request's current head has been reviewed. */
export const REVIEWED_LABEL = "reviewed";

/**
 * The label Renovate gives a dependency update (renovate.json). Each waits for review: a poisoned release would
 * otherwise merge and deploy itself.
 */
export const DEPENDENCIES_LABEL = "dependencies";

/** Where money or personal data is decided. Each entry is the start of a path: a file, a family of files, or a folder. */
export const SENSITIVE_PATHS = [
  // Payments, refunds, credits, discounts, no-show charges, prices, invoices and receipts
  "src/domain/payments",
  "src/domain/client-payments",
  "src/domain/payment-links",
  "src/domain/refunds",
  "src/domain/credits",
  "src/domain/discount-code",
  "src/domain/no-show",
  "src/domain/referral-grants",
  "src/domain/price-book",
  // Books' customers, invoices, items and the payments recorded there
  "src/domain/books-",
  "src/policy/prices",
  "src/policy/prepayment",
  "src/policy/discount-codes",
  "src/policy/no-show",
  "src/policy/referral-reward",
  "src/config/gst",
  "src/providers/payments/",
  "src/providers/books/",
  "src/routes/hooks/razorpay",
  "src/routes/ops-credits",
  // Consent
  "src/domain/booking-consents",
  "src/domain/profile",
  "src/policy/consents",
  "src/config/notices",
  // Erasure, deletion and a client's export of their data
  "src/domain/erasure",
  "src/domain/deletion",
  "src/domain/data-export",
  "src/policy/account-deletion",
  "src/routes/ops-erasure",
  "src/routes/client/data",
  // Health data
  "src/domain/hair-profiles",
  "src/policy/hair-profile",
  "src/routes/ops-hair-profile",
  "src/routes/hair-profile-schemas",
  // Every table
  "migrations/",
] as const;

export interface PullRequest {
  readonly number: number;
  readonly state: string;
  readonly draft: boolean;
  readonly headSha: string;
  /** The repository the pull request's branch is in, "owner/name"; null when that fork has been deleted. */
  readonly headRepository: string | null;
  /** The repository the pull request asks to merge into. */
  readonly baseRepository: string;
  readonly labels: readonly string[];
  /** Every path the pull request changes, with a renamed file's old path as well as its new one. */
  readonly files: readonly string[];
}

export interface Run {
  readonly conclusion: string;
  readonly headSha: string;
  readonly jobs: readonly { readonly name: string; readonly conclusion: string | null }[];
}

export type Verdict = { readonly merge: true } | { readonly merge: false; readonly reason: string };

function isSensitive(file: string): boolean {
  return SENSITIVE_PATHS.some((path) => file.startsWith(path));
}

export function sensitiveFiles(files: readonly string[]): string[] {
  return files.filter((file) => isSensitive(file));
}

export function mergeVerdict(pull: PullRequest, run: Run): Verdict {
  if (pull.headRepository !== pull.baseRepository) {
    return { merge: false, reason: "its branch is in a fork, not this repository" };
  }
  if (run.conclusion !== "success") return { merge: false, reason: "the run did not pass" };
  if (pull.state !== "open") return { merge: false, reason: "the pull request is not open" };
  if (pull.draft) return { merge: false, reason: "the pull request is a draft" };
  if (pull.labels.includes(HOLD_LABEL)) return { merge: false, reason: `it carries ${HOLD_LABEL}` };

  if (pull.labels.includes(DEPENDENCIES_LABEL) && !pull.labels.includes(REVIEWED_LABEL)) {
    return { merge: false, reason: `it updates dependencies and waits for the ${REVIEWED_LABEL} label` };
  }

  const sensitive = sensitiveFiles(pull.files);
  if (sensitive.length > 0 && !pull.labels.includes(REVIEWED_LABEL)) {
    const reason = `it touches money or personal data (${sensitive.join(", ")}) and waits for the ${REVIEWED_LABEL} label`;
    return { merge: false, reason };
  }

  if (run.headSha !== pull.headSha) return { merge: false, reason: "the run was on an older head" };
  const suite = run.jobs.find((job) => job.name === FULL_SUITE_JOB);
  if (suite?.conclusion !== "success") return { merge: false, reason: "the run did not pass the full suite" };
  return { merge: true };
}
