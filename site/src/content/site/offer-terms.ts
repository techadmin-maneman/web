// The terms of discount codes, referral rewards and free service visits, which yield to the Terms (docs/open-points-settled.md,
// item 189).

import type { LegalPage } from "./legal.ts";

export const offerTerms: LegalPage = {
  publish: true,
  approved: true,
  title: "Offer Terms",
  version: { number: "1.00", date: "25 October 2026" },
  intro: [
    "These offer terms apply to Mane Man’s discount codes, referral rewards and free service visits (each, an “Offer”). They are Supplemental Terms under our Terms and Conditions, available at https://maneman.in/terms (“Terms”), and capitalised terms have the meanings the Terms give them. Where these offer terms and the Terms differ, the Terms prevail.",
  ],
  sections: [
    {
      heading: "Discount codes",
      blocks: [
        {
          text: "A discount code reduces the Fees of a visit by the percentage or the amount stated when it is issued, up to any limit stated, and may cover the whole of them.",
        },
        {
          text: "A code applies only to the kinds of visit, and until the last day, stated for it, may be used once by each Customer unless stated otherwise, and may be limited in its total number of uses.",
        },
        {
          text: "A code is entered before the visit is paid for, and cannot be added after payment, exchanged for cash, or combined with another code. Where Mane Man Credits can pay for a visit, they are used first, and a code does not apply to that visit.",
        },
        {
          text: "A code entered on a booking stays with it if the booking is moved, and can be used again if the booking is cancelled.",
        },
      ],
    },
    {
      heading: "Referral rewards",
      blocks: [
        {
          text: "Once you have had your first consultation, you may invite friends to Mane Man through the Mane Man app.",
        },
        {
          text: "When a friend books through your invite and their first fit is completed, each of you earns the free service visits shown in the app when you shared the invite, if any, to be used by the date then shown.",
        },
        {
          text: "A friend must be new to Mane Man. You may not invite yourself, or open more than one Account to earn a reward. Mane Man may review a reward before granting it, and may decline it; if it does, each of you is told.",
        },
        {
          text: "With your agreement, your before-and-after photographs and first name appear on the card your friends see when you share an invite, as set out in the notices on the Platform.",
        },
      ],
    },
    {
      heading: "Free service visits",
      blocks: [
        {
          text: "Free service visits are Mane Man Credits. A free service visit is used when you book a service visit, and must be booked by its last day; a visit booked by then is covered even if it takes place later.",
        },
        {
          text: "A free service visit used on a visit cancelled in time returns to your Account. One used on a visit cancelled late, or missed, may not be returned, as the Terms set out.",
        },
        {
          text: "Free service visits have no cash value, cannot be transferred or sold, and end when your Account is deleted.",
        },
      ],
    },
    {
      heading: "General",
      blocks: [
        {
          text: "Mane Man may change or withdraw an Offer at any time. A reward already granted stays valid until its last day.",
        },
        {
          text: "Mane Man may refuse, withhold or reverse an Offer it reasonably believes was obtained in error, fraudulently, or in breach of these offer terms or the Terms.",
        },
      ],
    },
  ],
};
