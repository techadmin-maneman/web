// A visit's length as a sentence says it, the same on the site and in what its build reads from the API: under two
// hours in minutes, "60 minutes", "90 minutes"; from two hours, "2 hours", "2 hours 15 minutes". It imports nothing, so
// a build script in plain Node can use it.

export function lengthWords(minutes: number): string {
  if (minutes < 120) return `${String(minutes)} minutes`;
  const hours = `${String(Math.floor(minutes / 60))} hours`;
  const rest = minutes % 60;
  return rest === 0 ? hours : `${hours} ${String(rest)} minutes`;
}
