// The client's hair profile, on their Pieces tab (docs/decisions/0106-a-clients-hair-profile.md): the profile as it
// stands, the fit spec a replacement is ordered to and the client's history; then every version, who recorded it and
// at which visit; and the form ops correct it with. No board draws it: board B1's Pieces tab draws the pieces alone.
//
// A correction is the whole profile as it now stands, sent as a new version, so the form starts from the latest.

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

/** A figure as typed: nothing is null. One that is not a number at all is caught before it is sent (notNumbers). */
const numberOf = (text: string): number | null => (text.trim() === "" ? null : Number(text.trim()));
const codeOf = (text: string): string | null => (text === "" ? null : text);

const isNotANumber = (text: string): boolean => text.trim() !== "" && !Number.isFinite(Number(text.trim()));

/** The figures typed that are no number, which JSON would send as nothing; the API checks the ranges of the rest. */
function notNumbers(draft: Draft): string[] {
  const figures: string[] = FIGURES.filter((field) => isNotANumber(draft.figures[field]));
  const yearAsked = draft.remedies.includes("transplant");
  return yearAsked && isNotANumber(draft.year) ? [...figures, "transplant_year"] : figures;
}

/**
 * The correction as the API takes it, naming the latest version the form was read from; the API checks every list
 * and range, names any field it refuses, and refuses it whole once another version has become the latest.
 */
function correctionOf(draft: Draft, basedOn: string | null): HairCorrection {
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
  const skin = draft.skin.trim();
  const year = draft.remedies.includes("transplant") ? numberOf(draft.year) : null;
  const said = draft.remedies.length > 0 || year !== null || skin !== "";
  if (!said) return { fit, history: null, based_on: basedOn };
  return {
    fit,
    history: { remedies: [...draft.remedies], transplant_year: year, skin_and_allergies: skin === "" ? null : skin },
    based_on: basedOn,
  };
}

/** The fields the API refused, by the name the form gives them. */
const refusedFields = (fields: readonly string[]): string[] =>
  fields.map((field) => field.replace(/^(fit|history)\./, ""));

function CorrectionForm({
  clientId,
  page,
  onSaved,
  onMoved,
  onCancel,
}: {
  clientId: string;
  page: ClientHairProfile;
  onSaved: (page: ClientHairProfile) => void;
  /** Another version became the latest while the form was open: the profile is to be read again. */
  onMoved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(page.latest));
  const [refused, setRefused] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const formId = useId();

  const save = () =>
    once(async () => {
      const typedWrong = notNumbers(draft);
      if (typedWrong.length > 0) {
        setRefused(typedWrong);
        setProblem(copy.refused);
        return;
      }
      const answer = await api.correctHairProfile(clientId, correctionOf(draft, page.latest?.id ?? null));
      if (answer.ok) {
        onSaved(answer.body);
        return;
      }
      if (answer.status === 409) {
        onMoved();
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

/** The hair systems offered today, and the profile's product where it is no longer one, so the form keeps it. */
function productOptions(products: Products, latest: HairProfileView | null): { value: string; label: string }[] {
  const options = products.map((product) => ({ value: product.tier, label: product.name }));
  const kept = latest?.fit.product ?? null;
  if (kept === null || options.some((option) => option.value === kept)) return options;
  return [...options, { value: kept, label: latest?.fit.product_name ?? kept }];
}

export function HairProfile({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientHairProfile(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  // What the correction answered, which stands over what was read when the tab opened.
  const [saved, setSaved] = useState<ClientHairProfile | null>(null);
  const [correcting, setCorrecting] = useState(false);
  // A correction refused because another version became the latest meanwhile: the profile was read again.
  const [moved, setMoved] = useState(false);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const page = saved ?? loaded.value;
  return (
    <section className={styles.profile} aria-labelledby="hair-profile-title">
      <h3 className={styles.title} id="hair-profile-title">
        {copy.title}
      </h3>
      {moved && (
        <p className={styles.error} role="alert">
          {copy.moved}
        </p>
      )}
      {page.latest === null ? <p className={styles.hint}>{copy.none}</p> : <ProfileRows profile={page.latest} />}
      {correcting ? (
        <CorrectionForm
          clientId={clientId}
          page={page}
          onSaved={(next) => {
            setSaved(next);
            setCorrecting(false);
            setMoved(false);
          }}
          onMoved={() => {
            setSaved(null);
            setCorrecting(false);
            setMoved(true);
            retry();
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
