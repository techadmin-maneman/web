// A short vibration where the brief asks for one (docs/prompts/tech-redesign.md, "Haptics"): a check-in, each photograph,
// the door's. A phone that cannot vibrate, or an iPhone's browser, which has no vibration, does nothing.

const SHORT_MS = 25;

export function buzz(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(SHORT_MS);
}
