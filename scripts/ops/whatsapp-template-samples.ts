// What each WhatsApp template's variables might say, for WhatsApp's reviewers: our params in our order
// (src/config/message-templates.ts), which ./whatsapp-templates.ts puts in each approved template's own order. Every
// name and number is made up.

import type { TemplateName } from "../../src/config/message-templates.ts";

/** A visit's params: first name, visit, day, arrival, technician, amount, reference, refund to, minutes, back. */
const VISIT = [
  "Rohit",
  "service visit",
  "Thu 24 Sep",
  "11:30 am–12 pm",
  "Imran",
  "Rs. 2,000",
  "MM-1042",
  "UPI",
  "20",
  "Rs. 1,500",
] as const;

/** A referral's params: first name, friend's name, visits, by when, the friend's. */
const REFERRAL = ["Rohit", "Karan", "3 service visits", "31 Dec 2026", "3 service visits"] as const;

const withVisit = (changes: Record<number, string>): readonly string[] =>
  VISIT.map((value, index) => changes[index + 1] ?? value);

/** Each submitted template's samples; one not listed takes a visit's. */
const SAMPLES: Partial<Record<TemplateName, readonly string[]>> = {
  tryon_result_v1: ["Rohit", "https://maneman.in/book"],
  login_code_v1: ["482913"],
  link_paid_v1: withVisit({ 2: "Mane Man Essential hair system", 6: "Rs. 25,000" }),
  move_proposed_v1: ["Rohit", "service visit", "Thu 24 Sep", "Fri 25 Sep", "11:30 am–12 pm", "Imran"],
  consultation_exists_v2: withVisit({ 2: "free consultation" }),
  waitlist_listed_v1: ["Rohit", "Bandra, Mumbai"],
  waitlist_listed_alert_v1: ["Rohit", "Bandra, Mumbai"],
  launch_alert_v1: ["Rohit", "Bandra, Mumbai", "https://maneman.in/book"],
  friend_fitted_v2: REFERRAL,
  friend_fitted_each_v1: REFERRAL,
  friend_fitted_yours_v1: REFERRAL,
  friend_fitted_thanks_v1: REFERRAL,
  friend_credited_v2: ["Karan", "3 service visits", "31 Dec 2026"],
  referral_rejected_referrer_v1: ["Rohit", "Karan"],
  referral_rejected_friend_v1: ["Karan"],
  credits_expiring_v1: ["Rohit", "2 service visits", "31 Dec 2026"],
  address_not_served_v2: ["Rohit", "400050"],
  deletion_rejected_v1: ["Rohit", "a visit of yours is booked for tomorrow."],
  fit_aftercare_v1: ["Rohit", "https://maneman.in/guides/looking-after-a-hair-system"],
};

/** The template's samples, in our params' order. */
export const samplesOf = (name: TemplateName): readonly string[] => SAMPLES[name] ?? VISIT;
