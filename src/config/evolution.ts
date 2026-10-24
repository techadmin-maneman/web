// What reaching our own WhatsApp bridge, Evolution, takes (src/providers/messaging/evolution.ts), as the settings read it.

export interface EvolutionSettings {
  /** https://…, no trailing slash. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
  /** The secret the delivery-receipt webhook sends as its Authorization header. Unset, the webhook answers 404. */
  readonly webhookToken: string | null;
}
