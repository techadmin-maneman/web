// Schema.org data for search engines, from content: the business on the home
// page, and the FAQ as it appears there. The prices in both are the price
// book's: the build writes them with the figures it has, and the mm-site Worker
// builds both again with the book's (docs/decisions/0073-prices-from-the-price-book.md).

import { business, faq, phone, whatsapp } from "../content/site.ts";
import type { PriceWords } from "./prices.ts";
import { SITE_ORIGIN } from "./site-origin.ts";
import { fill } from "./text.ts";

/** The number search engines show: the phone line once published, else the WhatsApp number. */
function telephone(): string | undefined {
  if (phone.publish) return phone.number;
  if (whatsapp.publish) return `+${whatsapp.number}`;
  return undefined;
}

export function localBusiness(prices: PriceWords): object {
  const number = telephone();
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    description: business.description,
    url: `${SITE_ORIGIN}/`,
    image: `${SITE_ORIGIN}/og.png`,
    priceRange: fill(business.priceRange, prices),
    areaServed: business.areaServed.map((name) => ({ "@type": "City", name })),
    ...(number === undefined ? {} : { telephone: number }),
  };
}

export function faqPage(prices: PriceWords): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: fill(item.a, prices) },
    })),
  };
}

/** One block of structured data as a page carries it: JSON that can never close its own script element. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
