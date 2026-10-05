// The security headers a Phase 2 app serves, as a Workers static-assets
// _headers file (docs/decisions/0043-client-app.md). Each app states what it
// needs beyond its own origin; everything else is refused.

export interface AppPolicy {
  /** Hosts the page may call beyond its own origin, e.g. Razorpay's for the client app. */
  readonly connect?: readonly string[];
  /** Hosts scripts may load from beyond the app's own origin. */
  readonly scripts?: readonly string[];
  /** Hosts the page may frame. */
  readonly frames?: readonly string[];
  /** Features the app grants itself, e.g. "otp-credentials". */
  readonly features?: readonly string[];
  /** Keeps a popup the page opens connected to it, as a payment provider's card check may need. */
  readonly popups?: boolean;
  /** Allows style elements and attributes a third-party script writes into the page. Inline scripts stay refused. */
  readonly inlineStyles?: boolean;
}

/** Denied unless an app grants itself one. */
const FEATURES = ["camera", "geolocation", "microphone", "payment", "otp-credentials", "usb", "bluetooth"] as const;

export function contentSecurityPolicy(policy: AppPolicy): string {
  const sources = (extra: readonly string[] | undefined) => ["'self'", ...(extra ?? [])].join(" ");
  return [
    "default-src 'none'",
    `script-src ${sources(policy.scripts)}`,
    `style-src ${policy.inlineStyles === true ? "'self' 'unsafe-inline'" : "'self'"}`,
    "img-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${sources(policy.connect)}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    `frame-src ${policy.frames === undefined ? "'none'" : policy.frames.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function permissionsPolicy(policy: AppPolicy): string {
  const granted = new Set(policy.features ?? []);
  return FEATURES.map((feature) => `${feature}=${granted.has(feature) ? "(self)" : "()"}`).join(", ");
}

/** The _headers file: every page under the policy, noindex, and the hashed assets cached for good. */
export function headersFile(policy: AppPolicy): string {
  return [
    "/*",
    `  Content-Security-Policy: ${contentSecurityPolicy(policy)}`,
    `  Permissions-Policy: ${permissionsPolicy(policy)}`,
    "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Cross-Origin-Opener-Policy: ${policy.popups === true ? "same-origin-allow-popups" : "same-origin"}`,
    // The apps are behind a login; nothing in them is for a search engine.
    "  X-Robots-Tag: noindex, nofollow",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
}
