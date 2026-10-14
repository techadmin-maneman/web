// Schema.org data for search engines, from content: the company and the site, the business and its FAQ on the home
// page, each guide as an article, and the way back to the home page from each page a level down. None gives a price:
// the site gives none (docs/decisions/0103-the-home-pages-first-copy-round.md).

import type { Guide } from "../content/guides.ts";
import { business, faq, whatsapp } from "../content/site.ts";
import { SITE_ORIGIN } from "./site-origin.ts";

const CONTEXT = "https://schema.org";

/** The company, by the address every other block names it with. */
const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;

/** The square mark search engines show beside the name: the home-screen icon. */
const LOGO = `${SITE_ORIGIN}/icon-512.png`;

/**
 * The number search engines show: the business's WhatsApp number, the only one the site gives. The footer shows it
 * as WhatsApp and not as a line to call.
 */
function telephone(): string | undefined {
  if (whatsapp.publish) return `+${whatsapp.number}`;
  return undefined;
}

/** The company as a block names it: an article's author and publisher. */
const company = () => ({
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: business.name,
  url: `${SITE_ORIGIN}/`,
});

export function organization(): object {
  return { "@context": CONTEXT, ...company(), logo: LOGO };
}

export function webSite(): object {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${SITE_ORIGIN}/#website`,
    name: business.name,
    url: `${SITE_ORIGIN}/`,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function localBusiness(): object {
  const number = telephone();
  return {
    "@context": CONTEXT,
    "@type": "LocalBusiness",
    "@id": `${SITE_ORIGIN}/#business`,
    name: business.name,
    description: business.description,
    url: `${SITE_ORIGIN}/`,
    image: `${SITE_ORIGIN}/og.png`,
    logo: LOGO,
    parentOrganization: { "@id": ORGANIZATION_ID },
    areaServed: business.areaServed.map((name) => ({ "@type": "City", name })),
    ...(number === undefined ? {} : { telephone: number }),
  };
}

export function faqPage(): object {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** A guide, written and published by the company, at its own address. */
export function guideArticle(guide: Guide): object {
  const url = `${SITE_ORIGIN}/guides/${guide.slug}`;
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.updated,
    author: company(),
    publisher: { ...company(), logo: LOGO },
    image: `${SITE_ORIGIN}/og.png`,
    mainEntityOfPage: url,
    url,
  };
}

/** The way back from a page, each step a name and its address: Home › Guides › the guide. */
export function breadcrumbs(trail: readonly { readonly name: string; readonly path: string }[]): object {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: new URL(step.path, SITE_ORIGIN).href,
    })),
  };
}

/** One block of structured data as a page carries it: JSON that can never close its own script element. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
