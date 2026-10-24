// What sending through MSG91 takes, as the settings read it: WhatsApp through its Business Platform
// (src/providers/messaging/msg91.ts), and login codes by SMS (src/providers/msg91-sms.ts).

export interface Msg91Settings {
  /** MSG91's API key, sent as the `authkey` header. */
  readonly authKey: string;
  /** The WhatsApp Business number MSG91 sends from, digits only with the country code: "919810000000". */
  readonly integratedNumber: string;
  /** The secret MSG91's webhook sends as its Authorization header (src/routes/hooks/msg91.ts); null, it is off. */
  readonly webhookToken: string | null;
}

export interface Msg91SmsSettings {
  /** The same API key WhatsApp through MSG91 sends with. */
  readonly authKey: string;
  /** The ID MSG91 gave the login code's SMS template once DLT approved its text. */
  readonly templateId: string;
}

/** The language every approved template is registered in. */
export const MSG91_TEMPLATE_LANGUAGE = "en";
