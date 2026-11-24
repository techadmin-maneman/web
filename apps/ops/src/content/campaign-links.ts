// The Campaign links page's words (docs/decisions/0288-attribution-and-conversions.md, docs/tracking.md). No design
// draws it; every word here is ours.

import { quantity } from "@maneman/web-kit/figures";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const campaignLinks = {
  title: "Campaign links",
  /** Beside the page's title: the links not retired. */
  live: (count: number) => `${quantity(count)} live`,
  newSociety: "New society activation",
  newOffer: "New offer link",
  kinds: { society: "Society", offer: "Offer" },
  society: {
    name: "Society",
    pincode: "Pincode",
    day: "Day",
    stall: "Stall fee, Rs.",
    staffHours: "Staff hours",
    staffRate: "Rate an hour, Rs.",
    collateral: "Collateral, Rs.",
    other: "Other costs, Rs.",
    otherNote: "What the other costs were",
  },
  offer: {
    name: "Name",
    source: "Where it goes",
    medium: "How",
    campaign: "Campaign",
    campaignHint: "Small letters and hyphens, starting with its city or national: gurgaon-diwali-offer.",
    city: "City",
    national: "National",
  },
  sources: {
    google: "Google",
    meta: "Meta (Facebook, Instagram)",
    youtube: "YouTube",
    whatsapp: "WhatsApp",
    newsletter: "Newsletter",
    partner: "Partner",
  },
  mediums: {
    cpc: "Paid search or display",
    paid_social: "Paid social",
    social: "Unpaid post",
    email: "E-mail",
    offline: "Print",
  },
  discount: "Discount on the first fit",
  noDiscount: "None",
  /** "3 h × Rs. 1,500", what staff on the day cost, the rate as the money formatter writes it. */
  staffNote: (hours: number, rate: string) => `${String(hours)} h × ${rate}`,
  /** What Make link waits for, said beneath it. */
  missing: {
    name: "Type a name.",
    pincode: "Type the society’s six-digit pincode.",
    campaign: "Type the campaign in small letters and hyphens.",
    /** A cost typed as anything but whole digits, named by its box. */
    figures: {
      stall: "Type the stall fee in whole rupees.",
      hours: "Type staff hours as a whole number.",
      rate: "Type the rate an hour in whole rupees.",
      collateral: "Type collateral in whole rupees.",
      other: "Type other costs in whole rupees.",
    },
    staff: "Type both staff hours and the rate an hour.",
  },
  /** "PROMO20 · 20% off" */
  discountWords: (code: string, kind: "percent" | "amount", value: string) =>
    `${code} · ${kind === "percent" ? `${value}% off` : `${value} off`}`,
  societyDiscountNote: "Only for an address in the society’s pincode.",
  make: "Make link",
  making: "Making…",
  columns: {
    name: "Name",
    kind: "Kind",
    link: "Link",
    code: "Code",
    discount: "Discount",
    spent: "Spent",
    touches: "Visits and chats",
    people: "People",
    made: "Made",
  },
  find: "Find a link",
  none: "No campaign links yet.",
  retired: "Retired",
  copy: "Copy",
  /** "Copy the link for Green Valley Towers" */
  copyLabel: (name: string) => `Copy the link for ${name}`,
  copied: "Link copied.",
  notCopied: "Not copied. Select the link in its row.",
  qrSvg: "QR (SVG)",
  qrPng: "QR (PNG)",
  qrLabel: (name: string, kind: string) => `Save the QR code for ${name} as ${kind}`,
  qrName: (slug: string, extension: string) => `maneman-${slug}-qr.${extension}`,
  retiring: {
    open: "Retire",
    label: (name: string) => `Retire the link for ${name}`,
    warning: (name: string) => `Retire the link for ${name}?`,
    confirm: "Retire",
    sending: "Retiring…",
  },
  errors: {
    name: "Type a name.",
    pincode: "Type the six-digit pincode of a place we hold.",
    city: "Choose a city from the list.",
    discount_code_id: changed("That discount code is switched off or not for a first fit."),
    utm_campaign: "Use small letters, digits and single hyphens.",
    amount: "Type whole rupees, Rs. 1 or more.",
    invalid_request: "Check the fields marked.",
    not_found: changed("Already retired."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
