// What sending through MSG91's WhatsApp Business Platform takes (src/providers/messaging/msg91.ts), as the settings
// read it.

export interface Msg91Settings {
  /** MSG91's API key, sent as the `authkey` header. */
  readonly authKey: string;
  /** The WhatsApp Business number MSG91 sends from, digits only with the country code: "919810000000". */
  readonly integratedNumber: string;
}

/** The language every approved template is registered in. */
export const MSG91_TEMPLATE_LANGUAGE = "en";
