// Schema.org data for search engines, from content: the business on the home
// page, and the FAQ as it appears there.

import { business, faq, whatsapp } from "../content/site.ts";
import { SITE_ORIGIN } from "./static-files.ts";

export function localBusiness(): object {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    description: business.description,
    url: `${SITE_ORIGIN}/`,
    image: `${SITE_ORIGIN}/og.png`,
    priceRange: business.priceRange,
    areaServed: business.areaServed.map((name) => ({ "@type": "City", name })),
    ...(whatsapp.publish ? { telephone: `+${whatsapp.number}` } : {}),
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
