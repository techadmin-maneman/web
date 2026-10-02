// The client app's policy. WebOTP reads the login code from an SMS where the
// phone allows. Razorpay Checkout loads from checkout.razorpay.com and pulls in
// its risk-detection script from cdn.razorpay.com, which Razorpay's fraud
// checks rely on; it opens its payment page in a frame from api.razorpay.com,
// sends its logs to the lumberjack hosts, and may open a popup for a card's
// check. It also writes a style element and a style attribute into the page,
// which change with Razorpay's releases, so no hash can allow them.

import type { AppPolicy } from "@maneman/web-kit/headers";

export const CLIENT_APP_POLICY: AppPolicy = {
  features: ["otp-credentials"],
  scripts: ["https://checkout.razorpay.com", "https://cdn.razorpay.com"],
  frames: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: [
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://lumberjack-cx.razorpay.com",
    "https://lumberjack-metrics.razorpay.com",
  ],
  popups: true,
  inlineStyles: true,
};
