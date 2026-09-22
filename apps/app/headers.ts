// The client app's policy (docs/decisions/0043-client-app.md). WebOTP reads
// the login code from an SMS where the phone allows (board A2). Razorpay
// Checkout (docs/decisions/0045-self-serve-booking.md) loads its script from
// checkout.razorpay.com, opens its payment page in a frame from
// api.razorpay.com, calls that and its logger, and may open a popup for a
// card's check.

import type { AppPolicy } from "@maneman/web-kit/headers";

export const CLIENT_APP_POLICY: AppPolicy = {
  features: ["otp-credentials"],
  scripts: ["https://checkout.razorpay.com"],
  frames: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com"],
  popups: true,
};
