import { whatsapp } from "../content.ts";

/** A chat with ops on WhatsApp, with `text` ready to send. */
export const whatsappWith = (text: string) => `https://wa.me/${whatsapp.number}?text=${encodeURIComponent(text)}`;
