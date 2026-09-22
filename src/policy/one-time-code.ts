// The login code (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M1.

export const RULES = [
  "Six digits, sent on WhatsApp.",
  "After 30 seconds the client may choose SMS instead.",
  "Five wrong attempts void the code.",
  "WhatsApp resend has a 30-second cooldown.",
] as const;

export const ONE_TIME_CODE = {
  digits: 6,
  smsOfferedAfterSeconds: 30,
  wrongAttemptsBeforeVoid: 5,
  whatsappResendCooldownSeconds: 30,
} as const;
