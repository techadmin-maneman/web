// The hair profile's form (./Profile.tsx), kept apart from the screen so its rules can be read and tested on their
// own (test/node/tech-profile-form.test.ts): the ranges the API takes a figure in, a figure as typed read as one, the
// remedies a client can say together, and the body the step sends
// (docs/decisions/0106-a-clients-hair-profile.md).

import type { FitSpec, History, ProfileRequest } from "../api.ts";

/** Each measurement's range, as src/policy/hair-profile.ts has it: the API refuses a figure outside it. */
export const MEASUREMENTS = {
  head_circumference_cm: { min: 40, max: 70 },
  front_to_nape_cm: { min: 20, max: 50 },
  ear_to_ear_cm: { min: 20, max: 50 },
  temple_to_temple_cm: { min: 20, max: 50 },
  base_width_in: { min: 2, max: 12 },
  base_length_in: { min: 2, max: 14 },
} as const;
export type Measurement = keyof typeof MEASUREMENTS;

export const GREY_PERCENT = { min: 0, max: 100 } as const;

/** The densities suppliers make, in per cent, in the API's order. */
export const DENSITIES = [80, 100, 120, 140] as const satisfies readonly NonNullable<FitSpec["density_percent"]>[];

/** The earliest year a transplant is taken to have been done in, as the API has it. */
export const FIRST_TRANSPLANT_YEAR = 1970;

type Range = { readonly min: number; readonly max: number };
export type Remedy = History["remedies"][number];

/** What a typed figure is: nothing typed, a figure the API takes, or one it would refuse. */
export type Typed = number | null | "invalid";

/** Up to three digits and at most one decimal: 57.5, 8, 33.0. */
const ONE_DECIMAL = /^\d{1,3}(?:\.\d)?$/;
const WHOLE = /^\d{1,4}$/;

function inRange(text: string, pattern: RegExp, range: Range): Typed {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!pattern.test(trimmed)) return "invalid";
  const figure = Number(trimmed);
  return figure >= range.min && figure <= range.max ? figure : "invalid";
}

/** A measurement as typed, to one decimal. */
export const figureOf = (text: string, range: Range): Typed => inRange(text, ONE_DECIMAL, range);

/** A whole number as typed: the grey's per cent, a transplant's year. */
export const wholeOf = (text: string, range: Range): Typed => inRange(text, WHOLE, range);

/** The figures as the form holds them, as typed. */
export type Figures = Record<Measurement | "grey_percent", string>;

/** The fit spec's choices, each one tap. */
export type Choices = Pick<
  FitSpec,
  "norwood_stage" | "colour" | "density_percent" | "wave" | "hairline" | "product" | "attachment"
>;

export interface FitForm {
  readonly choices: Choices;
  readonly figures: Figures;
}

const typedOf = (figure: number | null): string => (figure === null ? "" : String(figure));

/** The form as a profile left it, or empty where none was recorded. */
export function fitFormOf(fit: FitSpec | null): FitForm {
  return {
    choices: {
      norwood_stage: fit?.norwood_stage ?? null,
      colour: fit?.colour ?? null,
      density_percent: fit?.density_percent ?? null,
      wave: fit?.wave ?? null,
      hairline: fit?.hairline ?? null,
      product: fit?.product ?? null,
      attachment: fit?.attachment ?? null,
    },
    figures: {
      head_circumference_cm: typedOf(fit?.head_circumference_cm ?? null),
      front_to_nape_cm: typedOf(fit?.front_to_nape_cm ?? null),
      ear_to_ear_cm: typedOf(fit?.ear_to_ear_cm ?? null),
      temple_to_temple_cm: typedOf(fit?.temple_to_temple_cm ?? null),
      base_width_in: typedOf(fit?.base_width_in ?? null),
      base_length_in: typedOf(fit?.base_length_in ?? null),
      grey_percent: typedOf(fit?.grey_percent ?? null),
    },
  };
}

/** Each figure as the API would take it. */
export function typedFigures(figures: Figures): Record<keyof Figures, Typed> {
  return {
    head_circumference_cm: figureOf(figures.head_circumference_cm, MEASUREMENTS.head_circumference_cm),
    front_to_nape_cm: figureOf(figures.front_to_nape_cm, MEASUREMENTS.front_to_nape_cm),
    ear_to_ear_cm: figureOf(figures.ear_to_ear_cm, MEASUREMENTS.ear_to_ear_cm),
    temple_to_temple_cm: figureOf(figures.temple_to_temple_cm, MEASUREMENTS.temple_to_temple_cm),
    base_width_in: figureOf(figures.base_width_in, MEASUREMENTS.base_width_in),
    base_length_in: figureOf(figures.base_length_in, MEASUREMENTS.base_length_in),
    grey_percent: wholeOf(figures.grey_percent, GREY_PERCENT),
  };
}

const sent = (typed: Typed): number | null => (typed === "invalid" ? null : typed);

/** The fit spec to send; null while any figure is one the API would refuse. */
export function fitOf(form: FitForm): FitSpec | null {
  const typed = typedFigures(form.figures);
  if (Object.values(typed).includes("invalid")) return null;
  return {
    ...form.choices,
    head_circumference_cm: sent(typed.head_circumference_cm),
    front_to_nape_cm: sent(typed.front_to_nape_cm),
    ear_to_ear_cm: sent(typed.ear_to_ear_cm),
    temple_to_temple_cm: sent(typed.temple_to_temple_cm),
    base_width_in: sent(typed.base_width_in),
    base_length_in: sent(typed.base_length_in),
    grey_percent: sent(typed.grey_percent),
  };
}

/**
 * "None" is said alone: choosing it clears the rest, and choosing any other clears it. Choosing one already chosen
 * takes it off.
 */
export function toggleRemedy(chosen: readonly Remedy[], remedy: Remedy): Remedy[] {
  if (chosen.includes(remedy)) return chosen.filter((each) => each !== remedy);
  if (remedy === "none") return ["none"];
  return [...chosen.filter((each) => each !== "none"), remedy];
}

export interface HistoryForm {
  readonly remedies: readonly Remedy[];
  readonly year: string;
  readonly skin: string;
}

export function historyFormOf(history: History | null): HistoryForm {
  return {
    remedies: history?.remedies ?? [],
    year: typedOf(history?.transplant_year ?? null),
    skin: history?.skin_and_allergies ?? "",
  };
}

/** A transplant's year, as typed: only beside a transplant, and no later than this year. */
export function yearOf(form: HistoryForm, thisYear: number): Typed {
  if (!form.remedies.includes("transplant")) return null;
  return wholeOf(form.year, { min: FIRST_TRANSPLANT_YEAR, max: thisYear });
}

/** The history to send; null while its year is one the API would refuse. */
export function historyOf(form: HistoryForm, thisYear: number): History | null {
  const year = yearOf(form, thisYear);
  if (year === "invalid") return null;
  const skin = form.skin.trim();
  return { remedies: [...form.remedies], transplant_year: year, skin_and_allergies: skin === "" ? null : skin };
}

/** The whole body: the fit spec, and the history, as none where nothing of it was said. */
export function bodyOf(fit: FitSpec, history: History): ProfileRequest {
  const said = history.remedies.length > 0 || history.transplant_year !== null || history.skin_and_allergies !== null;
  return { fit, history: said ? history : null };
}
