// How a visitor reaches the business.

import { WHATSAPP_DISPLAY, WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";
import { pageDescriptions } from "./pages.ts";

/** The business WhatsApp number: the footer's, the legal pages', and every wa.me link. */
export const whatsapp = {
  publish: true,
  number: WHATSAPP_NUMBER,
  display: WHATSAPP_DISPLAY,
  label: `WhatsApp · ${WHATSAPP_DISPLAY}`,
};

/** The business as search engines read it (LocalBusiness). Only published facts. */
export const business = {
  name: "Mane Man",
  description: pageDescriptions.home,
  /** The cities the FAQ says are covered. */
  areaServed: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
  /**
   * A first fit, from the cheapest hair system ops offer to the dearest. Given only while the site gives prices
   * (PRICES_SHOWN, site/src/lib/flags.ts).
   */
  priceRange: "{firstFitRange}",
};
