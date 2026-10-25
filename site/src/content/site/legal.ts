// The privacy policy and the terms, as counsel drafted them (privacy-policy.ts, terms-and-conditions.ts), and the shape
// a legal page takes.

import { privacyPolicy } from "./privacy-policy.ts";
import { termsAndConditions } from "./terms-and-conditions.ts";

/** A section's clause, or a clause's item, numbered in turn ("1.2.", "(b)", "(ii)"): its run-in heading, then its words. */
export interface LegalClause {
  readonly lead?: string;
  readonly text: string;
  readonly items?: readonly LegalBlock[];
}

/** A clause, or words that take no number: a paragraph, or lines such as a name and an address. */
export type LegalBlock = LegalClause | { readonly paragraph: string } | { readonly lines: readonly string[] };

export interface LegalSection {
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalPage {
  readonly publish: boolean;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly title: string;
  readonly version: { readonly number: string; readonly date: string };
  readonly intro: readonly string[];
  readonly sections: readonly LegalSection[];
  /** A table after the sections, as the terms' cancellation charges, and the line beneath it. */
  readonly annex?: {
    readonly heading: string;
    readonly head: readonly string[];
    readonly rows: readonly (readonly string[])[];
    readonly note: string;
  };
}

export const legalPages: { readonly privacy: LegalPage; readonly terms: LegalPage } = {
  privacy: privacyPolicy,
  terms: termsAndConditions,
};

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

/** The page of full notices each one-line consent links to (/notices). */
export const noticesPage = { title: "Notices" };
