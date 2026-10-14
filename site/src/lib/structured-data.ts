// Schema.org data for search engines, from content: the business on the home page, and the FAQ as it appears there.
// Neither gives a price: the site gives none (docs/decisions/0103-the-home-pages-first-copy-round.md).

import { business, faq, whatsapp } from "../content/site.ts";
import { SITE_ORIGIN } from "./site-origin.ts";

/**
 * The number search engines show: the business's WhatsApp number, the only one the site gives. The footer shows it
 * as WhatsApp and not as a line to call.
 */
function telephone(): string | undefined {
  if (whatsapp.publish) return `+${whatsapp.number}`;
  return undefined;
}

export function localBusiness(): object {
  const number = telephone();
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    description: business.description,
    url: `${SITE_ORIGIN}/`,
    image: `${SITE_ORIGIN}/og.png`,
    areaServed: business.areaServed.map((name) => ({ "@type": "City", name })),
    ...(number === undefined ? {} : { telephone: number }),
  };
}

export function faqPage(): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** One block of structured data as a page carries it: JSON that can never close its own script element. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
