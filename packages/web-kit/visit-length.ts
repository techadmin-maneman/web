// A visit's length as a sentence says it, the same on the site and in what its build reads from the API: "1 hour",
// "90 minutes", "2 hours 15 minutes". It imports nothing, so a build script in plain Node can use it.

export function lengthWords(minutes: number): string {
  if (minutes < 120 && minutes % 60 !== 0) return `${String(minutes)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const whole = `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? whole : `${whole} ${String(rest)} minutes`;
}
