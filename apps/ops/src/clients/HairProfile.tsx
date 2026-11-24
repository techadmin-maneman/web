// The client's hair profile, on their Pieces tab (docs/decisions/0106-a-clients-hair-profile.md): the profile, the fit
// spec a replacement is ordered to, a row each, and every version with who recorded it at which visit. Each row is
// corrected from its own Change (docs/decisions/0314-change-everywhere-and-forms-in-a-grid.md); its save sends the
// whole profile again, that row changed, as a new version.

import { typeLook } from "@maneman/ui/type";
import { errorText } from "@maneman/web-kit/refusal";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Disclosure } from "@maneman/ui/Disclosure";
import { capsLook } from "@maneman/ui/Caps";
import { EditableRow } from "@maneman/ui/EditableRow";
import { Checkbox, Field, Select, TextInput, type FieldControl } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, yearInIndia } from "@maneman/web-kit/dates";
import {
  bodyOf,
  choicesWith,
  fitFormOf,
  fitOf,
  historyFormOf,
  historyOf,
  REMEDIES,
  toggleRemedy,
  type FigureName,
  type FitForm,
  type HistoryForm,
} from "@maneman/web-kit/hair-profile";
import { useCallback, useState, type ReactNode } from "react";
import { type ClientHairProfile, type HairProfileVersion, type HairProfileView } from "../api.ts";
import { clients, dispatch, NOT_PERMITTED, OFFLINE } from "../content.ts";
import { EDITING } from "../content/common.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./profile.module.css";
import { isOneOf } from "@rules/lib/one-of.ts";
import { Refusal } from "@maneman/ui/Refusal";
import { clientsApi } from "./clients-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.profile;

/** A row's Save, which keeps the whole profile as a new version. */
const WORDS = { ...EDITING, save: copy.save };

type Products = ClientHairProfile["products"];

/** The figures, typed. */
type Figure = FigureName;

/** The choices, each from its list. */
const CODES = ["norwood_stage", "colour", "density_percent", "wave", "hairline", "product", "attachment"] as const;
type Code = (typeof CODES)[number];

/** The history's rows: what the client has tried, a transplant's year, and their skin and allergies. */
const HISTORY_ROWS = ["remedies", "transplant_year", "skin_and_allergies"] as const;

/** A row of the profile: one of the fit spec's, or of the history's. */
type Row = Code | Figure | (typeof HISTORY_ROWS)[number];

/** The fit spec in the order the technician's phone takes it. */
const FIT_ROWS: readonly (Code | Figure)[] = [
  "norwood_stage",
  "head_circumference_in",
  "front_to_nape_in",
  "ear_to_ear_in",
  "temple_to_temple_in",
  "base_width_in",
  "base_length_in",
  "colour",
  "grey_percent",
  "density_percent",
  "wave",
  "hairline",
  "product",
  "attachment",
];

const isCode = (row: Row): row is Code => isOneOf(CODES, row);
const isHistory = (row: Row): row is (typeof HISTORY_ROWS)[number] => isOneOf(HISTORY_ROWS, row);

/** Each list's codes, with their words, in the order they are written. */
function listOf(field: Exclude<Code, "product">): { value: string; label: string }[] {
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

/** A code's words, or the table's gap where none was recorded. */
function wordsOf(field: Code, fit: HairProfileView["fit"]): string {
  const value = fit[field];
  if (value === null) return clients.unknown;
  if (field === "product") return fit.product_name ?? String(value);
  return listOf(field).find((option) => option.value === String(value))?.label ?? String(value);
}

const figureOf = (value: number | null): string => (value === null ? clients.unknown : String(value));

/** A row's value in a version, or the gap where it holds none. */
function valueOf(row: Row, profile: HairProfileView | null): string {
  if (profile === null) return clients.unknown;
  const { fit, history } = profile;
  if (row === "remedies") {
    const remedies = (history?.remedies ?? []).map((remedy) => copy.remedies[remedy]).join(", ");
    return remedies === "" ? clients.unknown : remedies;
  }
  if (row === "transplant_year") return figureOf(history?.transplant_year ?? null);
  if (row === "skin_and_allergies") return history?.skin_and_allergies ?? clients.unknown;
  return isCode(row) ? wordsOf(row, fit) : figureOf(fit[row]);
}

/** What a row was in the version before, where that version holds it. */
const wasOf = (row: Row, previous: HairProfileView | null): string | undefined =>
  previous === null || (isHistory(row) && previous.history === null) ? undefined : valueOf(row, previous);

/** A row's value, saying what it was where it differs from the version before. */
function shownOf(row: Row, profile: HairProfileView | null, previous: HairProfileView | null): ReactNode {
  const value = valueOf(row, profile);
  const was = wasOf(row, previous);
  if (was === undefined || was === value) return value;
  return (
    <>
      {value}
      <span className={styles.was}>{copy.was(was)}</span>
    </>
  );
}

/** A version's rows, each that differs from the version before it saying what it was. */
function ProfileRows({ profile, previous }: { profile: HairProfileView; previous: HairProfileView | null }) {
  const rows: readonly Row[] = profile.history === null ? FIT_ROWS : [...FIT_ROWS, ...HISTORY_ROWS];
  return (
    <DescriptionList
      layout="list"
      items={rows.map((row) => ({ term: copy.rows[row], details: shownOf(row, profile, previous) }))}
    />
  );
}

/** Who recorded a version: the technician at the visit, or the member of staff who corrected it. */
function byWhom(version: HairProfileVersion): string {
  if (version.recorded_by.kind === "ops") return copy.byOps(version.recorded_by.staff);
  const name = version.recorded_by.name ?? copy.unnamed;
  const type = version.visit?.type ?? null;
  return copy.atVisit(name, type === null ? copy.aVisit : dispatch.typeNames[type]);
}

function Versions({ versions }: { versions: readonly HairProfileVersion[] }) {
  return (
    <section className={styles.versions} aria-labelledby="hair-profile-versions">
      <h4 className={capsLook(styles.subtitle)} id="hair-profile-versions">
        {copy.versions}
      </h4>
      <ol className={styles.versionList}>
        {versions.map((version, index) => (
          <li key={version.id}>
            <Disclosure
              className={styles.version}
              summary={copy.version(longDate(version.recorded_at), byWhom(version))}
            >
              <ProfileRows profile={version} previous={versions[index + 1] ?? null} />
            </Disclosure>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The whole profile as typed, a row's box changing its part. */
interface Draft {
  readonly fit: FitForm;
  readonly history: HistoryForm;
}

const draftOf = (latest: HairProfileView | null): Draft => ({
  fit: fitFormOf(latest?.fit ?? null),
  history: historyFormOf(latest?.history ?? null),
});

/** The options a select offers. */
type SelectOptions = readonly { value: string; label: string }[];

/** The hair systems offered today, and the profile's product where it is no longer one, so a row keeps it. */
function productOptions(products: Products, latest: HairProfileView | null): SelectOptions {
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

/** What the client has tried, a tick each, and a transplant's year once a transplant is ticked. */
function RemediesBox({ control, draft, setDraft }: BoxProps) {
  const history = (next: Partial<HistoryForm>) => {
    setDraft({ ...draft, history: { ...draft.history, ...next } });
  };
  return (
    <span className={styles.remedies} id={control.id}>
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
    </span>
  );
}

/** A row's box: a choice from its list, a figure, the transplant's year, or the client's skin and allergies. */
function RowBox(props: BoxProps & { readonly row: Row; readonly products: SelectOptions }) {
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

/** The rows a profile is corrected from: a transplant's year only where a transplant is among what was tried. */
function rowsToCorrect(latest: HairProfileView | null): readonly Row[] {
  const transplant = latest?.history?.remedies.includes("transplant") ?? false;
  return [...FIT_ROWS, ...HISTORY_ROWS.filter((row) => row !== "transplant_year" || transplant)];
}

/**
 * The latest profile, a row each, each corrected from its own Change: the whole profile sent again as a new version,
 * from the version it was read from, so one recorded meanwhile is never silently replaced.
 */
function LatestRows(props: {
  clientId: string;
  page: ClientHairProfile;
  mayCorrect: boolean;
  onSaved: (page: ClientHairProfile) => void;
  /** Another version became the latest while a row was open: the profile is to be read again. */
  onMoved: () => void;
}) {
  const { page } = props;
  const latest = page.latest;
  const previous = page.versions[1] ?? null;
  const products = productOptions(page.products, latest);
  const save = async (draft: Draft): Promise<string | null> => {
    const thisYear = yearInIndia(apiNow());
    const fit = fitOf(draft.fit);
    const history = historyOf(draft.history, thisYear);
    if (fit === null || history === null) return copy.invalid;
    const answer = await clientsApi.correctHairProfile(props.clientId, bodyOf(fit, history, latest?.id ?? null));
    if (answer.ok) {
      props.onSaved(answer.body);
      return null;
    }
    if (answer.status === 409) {
      props.onMoved();
      return copy.moved;
    }
    if (answer.status === 400 && answer.fields.length > 0) return copy.invalid;
    return errorText({ not_permitted: NOT_PERMITTED, offline: OFFLINE, unknown: copy.failed }, answer);
  };
  return (
    <div className={styles.rows}>
      {rowsToCorrect(latest).map((row) => (
        <EditableRow<Draft>
          key={row}
          label={copy.rows[row]}
          words={WORDS}
          mayChange={props.mayCorrect}
          value={shownOf(row, latest, latest === null ? null : previous)}
          start={() => draftOf(latest)}
          save={save}
        >
          {(control, draft, setDraft) => (
            <RowBox row={row} control={control} draft={draft} setDraft={setDraft} products={products} />
          )}
        </EditableRow>
      ))}
    </div>
  );
}

export function HairProfile({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.clientHairProfile(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  // What a correction answered, which stands over what was read when the tab opened.
  const [saved, setSaved] = useState<ClientHairProfile | null>(null);
  // A correction refused because another version became the latest meanwhile: the profile was read again.
  const [moved, setMoved] = useState(false);
  const mayCorrect = useAccess().mayCall("POST /api/clients/{id}/hair-profile");

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const page = saved ?? loaded.value;
  return (
    <section className={styles.profile} aria-labelledby="hair-profile-title">
      <h3 className={typeLook("title-4", styles.title)} id="hair-profile-title">
        {copy.title}
      </h3>
      {moved && <Refusal className={styles.error} said={copy.moved} />}
      {page.latest === null && <p className={styles.hint}>{copy.none}</p>}
      {(page.latest !== null || mayCorrect) && (
        <LatestRows
          clientId={clientId}
          page={page}
          mayCorrect={mayCorrect}
          onSaved={(next) => {
            setSaved(next);
            setMoved(false);
          }}
          onMoved={() => {
            setSaved(null);
            setMoved(true);
            retry();
          }}
        />
      )}
      {page.versions.length > 0 && <Versions versions={page.versions} />}
    </section>
  );
}
