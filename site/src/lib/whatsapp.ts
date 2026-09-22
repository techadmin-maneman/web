/** A wa.me link to the business number, with an optional message. */
export function whatsappLink(number: string, text?: string): string {
  return text === undefined ? `https://wa.me/${number}` : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
