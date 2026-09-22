// Schema.org data for search engines, from content: the business on the home
// page, and the FAQ as it appears there.

import { business, faq, phone, whatsapp } from "../content/site.ts";
import { SITE_ORIGIN } from "./static-files.ts";

/** The number search engines show: the phone line once published, else the WhatsApp number. */
function telephone(): string | undefined {
  if (phone.publish) return phone.number;
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
    priceRange: business.priceRange,
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
