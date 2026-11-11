// The key pair the technicians' pushes are signed with (src/providers/web-push.ts), read from the Worker's secrets
// (./settings-sections.ts).

export interface VapidKeys {
  /** The public key the phone subscribes with: the uncompressed P-256 point, 65 bytes, base64url. */
  readonly publicKey: string;
  /** The private scalar, 32 bytes, base64url. */
  readonly privateKey: string;
  /** Who the push service may contact about our pushes: an https: or mailto: URL. */
  readonly subject: string;
}
