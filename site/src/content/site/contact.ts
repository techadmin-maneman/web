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

/**
 * The company's pages elsewhere, beside the number in the footer. Their addresses are still to come: until they are
 * here and the block is published, they show outside production only, and lead nowhere.
 */
export const socialLinks = {
  publish: false,
  links: [
    { icon: "linkedin", label: "Mane Man on LinkedIn", href: null },
    { icon: "instagram", label: "Mane Man on Instagram", href: null },
  ] satisfies { icon: "linkedin" | "instagram"; label: string; href: string | null }[],
};

/**
 * The bar that asks for consent to the ad and measurement tags (site/src/components/ConsentBar.astro). The Privacy
 * Policy's Cookies section says the rest.
 */
export const consentBar = {
  publish: true,
  label: "Cookies",
  text: "We use cookies to analyse site traffic and measure our advertising. You can accept or decline them.",
  privacy: "Privacy Policy",
  accept: "Accept",
  decline: "Decline",
};

/** The booking form or the try-on, when it failed to draw: the way to us instead. */
export const islandFailed = {
  publish: true,
  message: "This didn’t load. Message us on WhatsApp and we’ll help you from there.",
  action: "Message us on WhatsApp",
};

/** The business as search engines read it (LocalBusiness). Only published facts. */
export const business = {
  name: "Mane Man",
  description: pageDescriptions.home,
  /** The cities the FAQ says are covered. */
  areaServed: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
};
