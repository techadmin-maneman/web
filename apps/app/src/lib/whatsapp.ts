import { whatsapp } from "../content.ts";

/** A chat with ops on WhatsApp, with `text` ready to send. */
export const whatsappWith = (text: string) => `https://wa.me/${whatsapp.number}?text=${encodeURIComponent(text)}`;

/** WhatsApp with `text` ready to send to whoever the client picks there: how an invite is shared. */
export const whatsappShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
