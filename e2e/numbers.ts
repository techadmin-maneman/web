// Made-up numbers the tests and the local seed give the people they make: no copy, so a script in plain Node can
// import it as the browser tests do.

/** A random mobile number, so the API's per-number daily limit never trips. */
export function randomMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}
