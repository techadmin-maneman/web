// WhatsApp, as every front end reaches it: the business's number, a chat with
// any number, and words to share with whoever the sender picks. The links are
// wa.me's, which open the app on a phone and WhatsApp Web at a desk.

/** The business's WhatsApp, the owner's number since 22 September 2026: digits with the country code, no "+". */
export const WHATSAPP_NUMBER = "919007973247";

/** A chat with `number`, written any way ("+91 98100 04417"), with `text` ready to send if there is any. */
export function whatsappChat(number: string, text?: string): string {
  const chat = `https://wa.me/${number.replace(/\D/g, "")}`;
  return text === undefined ? chat : `${chat}?text=${encodeURIComponent(text)}`;
}

/** WhatsApp with `text` ready to send to whoever the sender picks there, as an invite or a result is shared. */
export function whatsappShare(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
