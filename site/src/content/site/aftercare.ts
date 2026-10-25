// The aftercare policy the terms' guarantee and wear clauses point to (docs/open-points-settled.md, item 189).

import type { LegalPage } from "./legal.ts";

export const aftercarePolicy: LegalPage = {
  publish: true,
  approved: true,
  title: "Aftercare Policy",
  version: { number: "1.00", date: "25 October 2026" },
  intro: [
    "This aftercare policy sets out how to look after your hair system between visits. It forms part of our Terms and Conditions, available at https://maneman.in/terms (“Terms”). The fitting guarantee under the Terms does not apply where the fit of the hair system is affected because this policy was not followed.",
  ],
  sections: [
    {
      heading: "The first 48 hours",
      blocks: [
        {
          text: "Keep the hair system and your scalp dry for 24 to 48 hours after it is bonded, as your technician tells you: no washing, swimming, steam or sauna, and no heavy sweating, such as a workout.",
        },
        { text: "Do not brush hard at the hairline, or pull at the edges, while the adhesive sets." },
      ],
    },
    {
      heading: "Every day",
      blocks: [
        {
          text: "Wash and style the hair system like your own hair, gently, with the products your technician recommends, and pat it dry rather than rubbing it.",
        },
        {
          text: "Brush gently with a wide-tooth comb or a paddle brush, from the ends towards the roots, holding the hair near the base.",
        },
        {
          text: "Keep heat low: a hair dryer on a cool or warm setting, and no straightener or curling iron near the base.",
        },
        { text: "Sleep with the hair system dry, on a smooth pillowcase." },
      ],
    },
    {
      heading: "Water, sun and products",
      blocks: [
        {
          text: "After a swim in chlorinated or sea water, rinse the hair system in fresh water as soon as you can: both shorten the life of the base.",
        },
        {
          text: "Keep oil-based and alcohol-based products, such as hair oils and some sprays, away from the base and the hairline: they weaken the adhesive.",
        },
        { text: "Ask your technician before using any product they have not recommended." },
      ],
    },
    {
      heading: "What not to do",
      blocks: [
        { text: "Do not remove, lift, re-glue or re-tape the hair system yourself, or trim or thin it yourself." },
        {
          text: "Do not let a barber or salon cut, colour, perm or remove the hair system. Message us, and your technician will do it.",
        },
        { text: "Do not colour or bleach the hair system." },
      ],
    },
    {
      heading: "Service visits",
      blocks: [
        {
          text: "The hair system needs a service visit about once a month: your technician lifts it, cleans the base and your scalp, bonds it again and refreshes the cut. Book each visit in the Mane Man app.",
        },
      ],
    },
    {
      heading: "When to contact us",
      blocks: [
        {
          text: "Message us at once if the hair system lifts or loosens, or if your scalp itches, reddens, blisters or is sore. Stop using any product you think may have caused it.",
        },
      ],
    },
  ],
};
