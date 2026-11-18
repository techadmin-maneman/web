// A number of days as the terms write one: the figure, then the word in brackets, "14 (fourteen)".

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

/** The word for a whole number from 0 to 99: "fourteen", "twenty-one". */
function inWords(count: number): string {
  if (count < 20) return ONES[count] ?? String(count);
  const ten = TENS[Math.floor(count / 10)] ?? "";
  const one = count % 10;
  return one === 0 ? ten : `${ten}-${ONES[one] ?? ""}`;
}

/** "14 (fourteen)"; a figure past 99 alone, which no setting the terms read reaches. */
export const legalDays = (count: number): string =>
  Number.isInteger(count) && count >= 0 && count < 100 ? `${String(count)} (${inWords(count)})` : String(count);

/** The hole in the terms' words the fit guarantee's days fill (docs/decisions/0256-fit-guarantee-setting.md). */
export const GUARANTEE_HOLE = "{guarantee_days}";
