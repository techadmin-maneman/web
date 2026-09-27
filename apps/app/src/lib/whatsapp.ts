import { WHATSAPP_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";

/** A chat with ops on WhatsApp, with `text` ready to send. */
export const whatsappWith = (text: string) => whatsappChat(WHATSAPP_NUMBER, text);
