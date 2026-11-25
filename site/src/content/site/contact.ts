// How a visitor reaches the business.

import { WHATSAPP_DISPLAY, WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";
import { pageDescriptions } from "./pages.ts";

/** The business WhatsApp number: the footer's, the legal pages', and every wa.me link. */
export const whatsapp = {
  publish: true,
  number: WHATSAPP_NUMBER,
  display: WHATSAPP_DISPLAY,
  label: `WhatsApp · ${WHATSAPP_DISPLAY}`,
  /** The words a chat begun from the site opens with, ahead of the visitor's reference ("Ref M7K2Q9XP"). */
  greeting: "Hi, I’d like to know more.",
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
  /** In each footer: the bar back, to answer again. */
  change: "Cookie choices",
  /** The answer in force, said on the bar Cookie choices brought back. */
  chosen: { granted: "You’ve accepted them.", denied: "You’ve declined them." },
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
  /**
   * The cities a build that reads none from the console names: a local one, for its tests. A deploy's build names the
   * cities ops serve (site/src/lib/served-cities.ts).
   */
  areaServed: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
};
