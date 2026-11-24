// A hair profile row's box, in the dialog its Change opens (./HairProfile.tsx): a choice from its list, a figure, what
// the client has tried with a transplant's year, or their skin and allergies. Each edits the whole profile as typed,
// which the row then sends as a new version.

import { Checkbox, ChoiceGroup, Field, Select, TextInput, type FieldControl } from "@maneman/ui/Field";
import {
  choicesWith,
  fitFormOf,
  historyFormOf,
  REMEDIES,
  toggleRemedy,
  type FigureName,
  type FitForm,
  type HistoryForm,
} from "@maneman/web-kit/hair-profile";
import { isOneOf } from "@rules/lib/one-of.ts";
import type { ClientHairProfile, HairProfileView } from "../api.ts";
import { clients } from "../content.ts";

const copy = clients.profile;

/** The choices, each from its list. */
const CODES = ["norwood_stage", "colour", "density_percent", "wave", "hairline", "product", "attachment"] as const;
export type Code = (typeof CODES)[number];

/** The history's rows: what the client has tried, a transplant's year, and their skin and allergies. */
export const HISTORY_ROWS = ["remedies", "transplant_year", "skin_and_allergies"] as const;

/** A row of the profile: one of the fit spec's, or of the history's. */
export type Row = Code | FigureName | (typeof HISTORY_ROWS)[number];

export const isCode = (row: Row): row is Code => isOneOf(CODES, row);

/** Each list's codes, with their words, in the order they are written. */
export function listOf(field: Exclude<Code, "product">): { value: string; label: string }[] {
  const words: Readonly<Record<string, string>> = {
    norwood_stage: copy.stages,
    colour: copy.colours,
    density_percent: copy.densities,
    wave: copy.waves,
    hairline: copy.hairlines,
    attachment: copy.attachments,
  }[field];
  return Object.entries(words).map(([value, label]) => ({ value, label }));
}

/** The whole profile as typed, a row's box changing its part. */
export interface Draft {
  readonly fit: FitForm;
  readonly history: HistoryForm;
}

export const draftOf = (latest: HairProfileView | null): Draft => ({
  fit: fitFormOf(latest?.fit ?? null),
  history: historyFormOf(latest?.history ?? null),
});

/** The options a select offers. */
export type SelectOptions = readonly { value: string; label: string }[];

/** The hair systems offered today, and the profile's product where it is no longer one, so a row keeps it. */
export function productOptions(products: ClientHairProfile["products"], latest: HairProfileView | null): SelectOptions {
  const options = products.map((product) => ({ value: product.tier, label: product.name }));
  const kept = latest?.fit.product ?? null;
  if (kept === null || options.some((option) => option.value === kept)) return options;
  return [...options, { value: kept, label: latest?.fit.product_name ?? kept }];
}

interface BoxProps {
  readonly control: FieldControl;
  readonly draft: Draft;
  readonly setDraft: (next: Draft) => void;
}

/** What the client has tried, a tick each, named by the dialog's title, and a transplant's year once one is ticked. */
function RemediesBox({ draft, setDraft }: BoxProps) {
  const history = (next: Partial<HistoryForm>) => {
    setDraft({ ...draft, history: { ...draft.history, ...next } });
  };
  return (
    <ChoiceGroup legend={copy.rows.remedies} legendLook="hidden" ruled>
      {REMEDIES.map((remedy) => (
        <Checkbox
          key={remedy}
          label={copy.remedies[remedy]}
          checked={draft.history.remedies.includes(remedy)}
          onChange={() => {
            history({ remedies: toggleRemedy(draft.history.remedies, remedy) });
          }}
        />
      ))}
      {draft.history.remedies.includes("transplant") && (
        <Field label={copy.rows.transplant_year}>
          {(own) => (
            <TextInput
              {...own}
              width="figure"
              inputMode="numeric"
              value={draft.history.year}
              onChange={(event) => {
                history({ year: event.target.value });
              }}
            />
          )}
        </Field>
      )}
    </ChoiceGroup>
  );
}

/** A row's box: a choice from its list, a figure, the transplant's year, or the client's skin and allergies. */
export function RowBox(props: BoxProps & { readonly row: Row; readonly products: SelectOptions }) {
  const { row, control, draft, setDraft } = props;
  if (row === "remedies") return <RemediesBox control={control} draft={draft} setDraft={setDraft} />;
  if (row === "transplant_year" || row === "skin_and_allergies") {
    const year = row === "transplant_year";
    return (
      <TextInput
        {...control}
        width={year ? "figure" : undefined}
        inputMode={year ? "numeric" : undefined}
        maxLength={year ? undefined : 200}
        value={year ? draft.history.year : draft.history.skin}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft({ ...draft, history: { ...draft.history, ...(year ? { year: typed } : { skin: typed }) } });
        }}
      />
    );
  }
  if (isCode(row)) {
    return (
      <Select
        {...control}
        width="choice"
        value={String(draft.fit.choices[row] ?? "")}
        onChange={(event) => {
          setDraft({
            ...draft,
            fit: { ...draft.fit, choices: choicesWith(draft.fit.choices, row, event.target.value) },
          });
        }}
      >
        <option value="">{copy.notRecorded}</option>
        {(row === "product" ? props.products : listOf(row)).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <TextInput
      {...control}
      width="figure"
      inputMode="decimal"
      value={draft.fit.figures[row]}
      onChange={(event) => {
        setDraft({ ...draft, fit: { ...draft.fit, figures: { ...draft.fit.figures, [row]: event.target.value } } });
      }}
    />
  );
}
