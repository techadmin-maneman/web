// The client's hair profile as a form (docs/decisions/0106-a-clients-hair-profile.md), the same for the technician's
// profile step and the console's correction: each figure as typed, read against the range the API takes it in; each
// choice one of its list; the remedies a client can say together; and the body sent. The lists and ranges are the
// API's own (src/policy/hair-profile.ts); the words for them are each app's.

import {
  ATTACHMENTS,
  COLOURS,
  DENSITIES,
  FIRST_TRANSPLANT_YEAR,
  GREY_PERCENT,
  HAIRLINES,
  MEASUREMENTS,
  NORWOOD_STAGES,
  REMEDIES,
  WAVES,
  type Attachment,
  type Colour,
  type Density,
  type Hairline,
  type Measurement,
  type NorwoodStage,
  type Remedy,
  type Wave,
} from "../../src/policy/hair-profile.ts";

export { COLOURS, DENSITIES, FIRST_TRANSPLANT_YEAR, GREY_PERCENT, MEASUREMENTS, REMEDIES };
export type { Measurement, Remedy };

/** The fit spec as the API takes it: null wherever nothing was recorded. */
export type FitSpec = Choices & Record<Measurement | "grey_percent", number | null>;

/** The fit spec's choices, each one of its list; the product is any service's tier. */
export type Choices = {
  readonly norwood_stage: NorwoodStage | null;
  readonly colour: Colour | null;
  readonly density_percent: Density | null;
  readonly wave: Wave | null;
  readonly hairline: Hairline | null;
  readonly product: string | null;
  readonly attachment: Attachment | null;
};

export type History = {
  readonly remedies: Remedy[];
  readonly transplant_year: number | null;
  readonly skin_and_allergies: string | null;
};

/** What the profile step and a correction send: the fit spec, the history or none, and the version the form began from. */
export type ProfileBody = { readonly fit: FitSpec; readonly history: History | null; readonly based_on: string | null };

type Range = { readonly min: number; readonly max: number };

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

export type FigureName = keyof Figures;

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
export function typedFigures(figures: Figures): Record<FigureName, Typed> {
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

const FIGURE_NAMES: readonly FigureName[] = [
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
  "base_width_in",
  "base_length_in",
  "grey_percent",
];

/** The figures typed that the API would refuse. */
export function refusedFigures(figures: Figures): FigureName[] {
  const typed = typedFigures(figures);
  return FIGURE_NAMES.filter((name) => typed[name] === "invalid");
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

const picked = <T extends string | number>(list: readonly T[], text: string): T | null =>
  list.find((value) => String(value) === text) ?? null;

/** The choices with one changed as a list's control gives it, as text: the list's own value, or none for anything else. */
export function choicesWith(choices: Choices, field: keyof Choices, text: string): Choices {
  switch (field) {
    case "norwood_stage":
      return { ...choices, norwood_stage: picked(NORWOOD_STAGES, text) };
    case "colour":
      return { ...choices, colour: picked(COLOURS, text) };
    case "density_percent":
      return { ...choices, density_percent: picked(DENSITIES, text) };
    case "wave":
      return { ...choices, wave: picked(WAVES, text) };
    case "hairline":
      return { ...choices, hairline: picked(HAIRLINES, text) };
    case "attachment":
      return { ...choices, attachment: picked(ATTACHMENTS, text) };
    case "product":
      return { ...choices, product: text === "" ? null : text };
  }
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

/** A history as the API answers it. */
type HistoryRead = {
  readonly remedies: readonly Remedy[];
  readonly transplant_year: number | null;
  readonly skin_and_allergies: string | null;
};

export function historyFormOf(history: HistoryRead | null): HistoryForm {
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

/**
 * The whole body: the fit spec, the history, as none where nothing of it was said, and the version the form started
 * from, so ops hear of one taken from a copy older than the latest.
 */
export function bodyOf(fit: FitSpec, history: History, basedOn: string | null): ProfileBody {
  const said = history.remedies.length > 0 || history.transplant_year !== null || history.skin_and_allergies !== null;
  return { fit, history: said ? history : null, based_on: basedOn };
}
