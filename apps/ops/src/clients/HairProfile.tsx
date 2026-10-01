// The client's hair profile, on their Pieces tab (docs/decisions/0106-a-clients-hair-profile.md): the profile as it
// stands, the fit spec a replacement is ordered to and the history recorded with the client's consent; then every
// version, who recorded it and at which visit; and the form ops correct it with. No board draws it: board B1's
// Pieces tab draws the pieces alone (docs/fidelity-method.md).
//
// A correction is the whole profile as it now stands, sent as a new version, so the form starts from the latest. The
// history is shown and corrected only while the client's consent to it stands: ops never give one.

import { Button } from "@maneman/ui/Button";
import { Checkbox, Field, TextInput } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useCallback, useId, useState } from "react";
import {
  api,
  type ClientHairProfile,
  type HairCorrection,
  type HairProfileVersion,
  type HairProfileView,
} from "../api.ts";
import { clients, dispatch } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./profile.module.css";

const copy = clients.profile;

type Fit = HairCorrection["fit"];
type History = NonNullable<HairCorrection["history"]>;
type Remedy = History["remedies"][number];
type Products = ClientHairProfile["products"];

/** The figures, typed. */
const FIGURES = [
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
  "base_width_in",
  "base_length_in",
  "grey_percent",
] as const satisfies readonly (keyof Fit)[];
type Figure = (typeof FIGURES)[number];

/** The choices, each from its list. */
const CODES = ["norwood_stage", "colour", "density_percent", "wave", "hairline", "product", "attachment"] as const;
type Code = (typeof CODES)[number];

/** The fit spec in the order the technician's phone takes it. */
const FIT_ROWS: readonly (Code | Figure)[] = [
  "norwood_stage",
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
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

const isCode = (field: Code | Figure): field is Code => (CODES as readonly string[]).includes(field);

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

/** Every row of a version: the fit spec, field by field, and its history where it holds one. */
function rowsOf(profile: HairProfileView): { key: string; value: string }[] {
  const { fit, history } = profile;
  const rows = FIT_ROWS.map((field) => ({
    key: copy.rows[field],
    value: isCode(field) ? wordsOf(field, fit) : figureOf(fit[field]),
  }));
  if (history === null) return rows;
  const remedies = history.remedies.map((remedy) => copy.remedies[remedy]).join(", ");
  return [
    ...rows,
    { key: copy.rows.remedies, value: remedies === "" ? clients.unknown : remedies },
    { key: copy.rows.transplant_year, value: figureOf(history.transplant_year) },
    { key: copy.rows.skin_and_allergies, value: history.skin_and_allergies ?? clients.unknown },
  ];
}

function ProfileRows({ profile }: { profile: HairProfileView }) {
  return (
    <dl className={styles.rows}>
      {rowsOf(profile).map((row) => (
        <div className={styles.row} key={row.key}>
          <dt className={styles.rowKey}>{row.key}</dt>
          <dd className={styles.rowValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Who recorded a version: the technician at the visit, or the member of staff who corrected it. */
function byWhom(version: HairProfileVersion): string {
  if (version.recorded_by.kind === "ops") return copy.byOps(version.recorded_by.staff);
  const name = version.recorded_by.name ?? copy.unnamed;
  const type = version.visit?.type ?? null;
  return copy.atVisit(name, type === null ? copy.aVisit : (dispatch.typeNames[type] ?? copy.aVisit));
}

function Versions({ versions }: { versions: readonly HairProfileVersion[] }) {
  return (
    <section className={styles.versions} aria-labelledby="hair-profile-versions">
      <h4 className={styles.subtitle} id="hair-profile-versions">
        {copy.versions}
      </h4>
      <ol className={styles.versionList}>
        {versions.map((version) => (
          <li key={version.id}>
            <details className={styles.version}>
              <summary className={styles.versionLine}>
                {copy.version(longDate(version.recorded_at), byWhom(version))}
              </summary>
              <ProfileRows profile={version} />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Draft {
  readonly codes: Record<Code, string>;
  readonly figures: Record<Figure, string>;
  readonly remedies: readonly Remedy[];
  readonly year: string;
  readonly skin: string;
}

const typed = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

function draftOf(latest: HairProfileView | null): Draft {
  const fit = latest?.fit ?? null;
  const history = latest?.history ?? null;
  return {
    codes: Object.fromEntries(CODES.map((field) => [field, typed(fit?.[field])])) as Record<Code, string>,
    figures: Object.fromEntries(FIGURES.map((field) => [field, typed(fit?.[field])])) as Record<Figure, string>,
    remedies: history?.remedies ?? [],
    year: typed(history?.transplant_year),
    skin: history?.skin_and_allergies ?? "",
  };
}

/** A figure as typed: nothing is null, and what is not a number is sent as one so the API names the field. */
const numberOf = (text: string): number | null => (text.trim() === "" ? null : Number(text.trim()));
const codeOf = (text: string): string | null => (text === "" ? null : text);

/** The correction as the API takes it; the API checks every list and range, and names any field it refuses. */
function correctionOf(draft: Draft, withHistory: boolean): HairCorrection {
  const { codes, figures } = draft;
  const fit = {
    norwood_stage: codeOf(codes.norwood_stage),
    colour: codeOf(codes.colour),
    density_percent: numberOf(codes.density_percent),
    wave: codeOf(codes.wave),
    hairline: codeOf(codes.hairline),
    product: codeOf(codes.product),
    attachment: codeOf(codes.attachment),
    ...Object.fromEntries(FIGURES.map((field) => [field, numberOf(figures[field])])),
  } as Fit;
  if (!withHistory) return { fit, history: null };
  const skin = draft.skin.trim();
  const year = draft.remedies.includes("transplant") ? numberOf(draft.year) : null;
  return {
    fit,
    history: { remedies: [...draft.remedies], transplant_year: year, skin_and_allergies: skin === "" ? null : skin },
  };
}

/** The fields the API refused, by the name the form gives them. */
const refusedFields = (fields: readonly string[]): string[] =>
  fields.map((field) => field.replace(/^(fit|history)\./, ""));

function CorrectionForm({
  clientId,
  page,
  onSaved,
  onCancel,
}: {
  clientId: string;
  page: ClientHairProfile;
  onSaved: (page: ClientHairProfile) => void;
  onCancel: () => void;
}) {
  const withHistory = page.health_consent.state === "given";
  const [draft, setDraft] = useState<Draft>(() => draftOf(page.latest));
  const [refused, setRefused] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const formId = useId();

  const save = () =>
    once(async () => {
      const answer = await api.correctHairProfile(clientId, correctionOf(draft, withHistory));
      if (answer.ok) {
        onSaved(answer.body);
        return;
      }
      const fields = answer.status === 400 ? refusedFields(answer.fields) : [];
      setRefused(fields);
      setProblem(fields.length > 0 ? copy.refused : copy.failed);
    });

  const select = (field: Code, options: readonly { value: string; label: string }[]) => (
    <Field label={copy.rows[field]} error={refused.includes(field) ? copy.invalid : null} key={field}>
      {(control) => (
        <select
          {...control}
          className={styles.select}
          value={draft.codes[field]}
          disabled={busy}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraft((was) => ({ ...was, codes: { ...was.codes, [field]: value } }));
          }}
        >
          <option value="">{copy.notRecorded}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const figure = (field: Figure) => (
    <Field label={copy.rows[field]} error={refused.includes(field) ? copy.invalid : null} key={field}>
      {(control) => (
        <TextInput
          {...control}
          className={styles.input}
          inputMode="decimal"
          value={draft.figures[field]}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            setDraft((was) => ({ ...was, figures: { ...was.figures, [field]: value } }));
          }}
        />
      )}
    </Field>
  );

  const products = productOptions(page.products, page.latest);

  return (
    <form
      className={styles.form}
      noValidate
      aria-busy={busy}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h4 className={styles.subtitle} id={`${formId}-title`}>
        {copy.formTitle}
      </h4>
      <p className={styles.hint}>{copy.formNote}</p>
      <div className={styles.fields}>
        {FIT_ROWS.map((field) => {
          if (!isCode(field)) return figure(field);
          return select(field, field === "product" ? products : listOf(field));
        })}
      </div>
      {withHistory && (
        <fieldset className={styles.history}>
          <legend className={styles.subtitle}>{copy.history}</legend>
          {Object.entries(copy.remedies).map(([remedy, label]) => (
            <Checkbox
              key={remedy}
              label={label}
              checked={draft.remedies.includes(remedy as Remedy)}
              disabled={busy}
              onChange={() => {
                setDraft((was) => ({ ...was, remedies: toggled(was.remedies, remedy as Remedy) }));
              }}
            />
          ))}
          {draft.remedies.includes("transplant") && (
            <Field label={copy.rows.transplant_year} error={refused.includes("transplant_year") ? copy.invalid : null}>
              {(control) => (
                <TextInput
                  {...control}
                  className={styles.input}
                  inputMode="numeric"
                  value={draft.year}
                  disabled={busy}
                  onChange={(event) => {
                    const year = event.target.value;
                    setDraft((was) => ({ ...was, year }));
                  }}
                />
              )}
            </Field>
          )}
          <Field
            label={copy.rows.skin_and_allergies}
            error={refused.includes("skin_and_allergies") ? copy.invalid : null}
          >
            {(control) => (
              <TextInput
                {...control}
                className={styles.input}
                maxLength={200}
                value={draft.skin}
                disabled={busy}
                onChange={(event) => {
                  const skin = event.target.value;
                  setDraft((was) => ({ ...was, skin }));
                }}
              />
            )}
          </Field>
        </fieldset>
      )}
      {problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" size="small" type="submit" busy={busy}>
          {busy ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

/** "None" is said alone: ticking it clears the rest, and ticking any other clears it. */
function toggled(chosen: readonly Remedy[], remedy: Remedy): Remedy[] {
  if (chosen.includes(remedy)) return chosen.filter((each) => each !== remedy);
  if (remedy === "none") return ["none"];
  return [...chosen.filter((each) => each !== "none"), remedy];
}

/** Every first-fit service, and the profile's product where it is one no longer held, so the form keeps it. */
function productOptions(products: Products, latest: HairProfileView | null): { value: string; label: string }[] {
  const options = products.map((product) => ({ value: product.tier, label: product.name }));
  const kept = latest?.fit.product ?? null;
  if (kept === null || options.some((option) => option.value === kept)) return options;
  return [...options, { value: kept, label: latest?.fit.product_name ?? kept }];
}

/** Why the history is not shown, where the client's consent to it does not stand. */
function noHistoryLine(page: ClientHairProfile): string | null {
  if (page.health_consent.state === "given") return null;
  return page.health_consent.state === "withdrawn" ? copy.historyWithdrawn : copy.historyNotGiven;
}

export function HairProfile({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientHairProfile(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  // What the correction answered, which stands over what was read when the tab opened.
  const [saved, setSaved] = useState<ClientHairProfile | null>(null);
  const [correcting, setCorrecting] = useState(false);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const page = saved ?? loaded.value;
  const noHistory = noHistoryLine(page);
  return (
    <section className={styles.profile} aria-labelledby="hair-profile-title">
      <h3 className={styles.title} id="hair-profile-title">
        {copy.title}
      </h3>
      {page.latest === null ? <p className={styles.hint}>{copy.none}</p> : <ProfileRows profile={page.latest} />}
      {noHistory !== null && <p className={styles.hint}>{noHistory}</p>}
      {correcting ? (
        <CorrectionForm
          clientId={clientId}
          page={page}
          onSaved={(next) => {
            setSaved(next);
            setCorrecting(false);
          }}
          onCancel={() => {
            setCorrecting(false);
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              setCorrecting(true);
            }}
          >
            {page.latest === null ? copy.record : copy.correct}
          </Button>
        </div>
      )}
      {page.versions.length > 0 && <Versions versions={page.versions} />}
    </section>
  );
}
