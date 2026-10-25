// The record of each time a person agrees to the terms and the privacy policy, as they book: on the site's form, on a
// friend's invite, or at the app's pay step. Rows are only ever added, and an erasure keeps them, as consents are kept.

import { LEGAL_VERSIONS } from "../../config/legal-versions.ts";

export type TermsSource = "site_booking" | "referral_landing" | "app_booking";

/** The write that records an acceptance of today's versions, to run in one batch with what it was given for. */
export function acceptTerms(
  db: D1Database,
  input: { readonly personId: string; readonly source: TermsSource; readonly ipHash: string; readonly at: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO terms_acceptances (id, person_id, terms_version, privacy_version, source, ip_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      input.personId,
      LEGAL_VERSIONS.terms,
      LEGAL_VERSIONS.privacy,
      input.source,
      input.ipHash,
      input.at,
    );
}
