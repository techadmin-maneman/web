// What reaching our own WhatsApp bridge, Evolution, takes (src/providers/evolution.ts), as the settings read it.

export interface EvolutionSettings {
  /** https://…, no trailing slash. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
  /** The secret in the delivery-receipt webhook's path. Unset, the webhook answers 404. */
  readonly webhookToken: string | null;
}
