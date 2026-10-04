// The names our own scripts and fixtures give an invented client or technician on staging, never a real one's
// (src/policy/staging-test-records.ts). Apart from the settings, so the apps can show a name as the server does.

/** The names our own scripts and fixtures give an invented client or technician, never a real one's. */
const STAGING_TEST_NAME_PREFIXES = ["Staging test", "Load test"] as const;

/**
 * Whether this name is one our own scripts and fixtures give an invented record. Exactly one of the names above, or
 * either followed by a word ("Staging test technician"), counts; nothing else does, so a script that gives its
 * invented record another name is the one that is wrong, not this check. A person's mark is read from people.test_record
 * once they exist; a technician's, whom ops alone name, from their name.
 */
export function isStagingTestName(name: string): boolean {
  return STAGING_TEST_NAME_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix} `));
}

/**
 * A name as a screen or message shows it: a test record's without its mark, so named copy can be judged on staging.
 * A name that is only the mark keeps it, and a real name never carries it.
 */
export function withoutTestMark(name: string): string {
  for (const prefix of STAGING_TEST_NAME_PREFIXES) {
    if (name.startsWith(`${prefix} `)) return name.slice(prefix.length).trim();
  }
  return name;
}
