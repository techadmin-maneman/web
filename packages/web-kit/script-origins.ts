// The hosts the pages load a script from: Turnstile's and the analytics tags'. The site's policy allows scripts from
// these alone (site/src/lib/static-files.ts), and Trusted Types' policies take a script's address from no other
// (./trusted-scripts.ts).

export const SCRIPT_ORIGINS: readonly string[] = [
  "https://challenges.cloudflare.com",
  "https://www.googletagmanager.com",
  "https://www.googleadservices.com",
  "https://www.google.com",
  "https://connect.facebook.net",
];
