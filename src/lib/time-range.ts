// A time of day, and a stretch of one, as a client reads them: "9 am", "12 noon", "9:30 am"; "9 am–12 noon",
// "12–4 pm", "9 am–9 pm". The times are India's clock, "HH:MM". A screen passes a no-break space, so "am" and "pm" stay
// on the line of their hour.

/** The space a screen puts between an hour and its "am" or "pm". */
export const UNBROKEN = " ";

interface Said {
  readonly number: string;
  readonly mark: "am" | "pm" | "noon" | "midnight";
}

function said(time: string): Said {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const number = `${String(hours % 12 === 0 ? 12 : hours % 12)}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`}`;
  if (minutes === 0 && hours === 12) return { number, mark: "noon" };
  if (minutes === 0 && hours === 0) return { number, mark: "midnight" };
  return { number, mark: hours < 12 ? "am" : "pm" };
}

/** "09:00" → "9 am", "12:00" → "12 noon", "21:30" → "9:30 pm". */
export function timeOfDay(time: string, space = " "): string {
  const { number, mark } = said(time);
  return `${number}${space}${mark}`;
}

/** "12:00" to "16:00" → "12–4 pm": the mark is said once where both ends share the half of the day. */
export function timeRange(start: string, end: string, space = " "): string {
  const [from, to] = [said(start), said(end)];
  const oneHalf = from.mark === to.mark || (from.mark === "noon" && to.mark === "pm");
  return oneHalf
    ? `${from.number}–${to.number}${space}${to.mark}`
    : `${timeOfDay(start, space)}–${timeOfDay(end, space)}`;
}
