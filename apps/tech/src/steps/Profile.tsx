// The client's hair profile, which no board draws (docs/decisions/0106-a-clients-hair-profile.md): a consultation's
// step, and a consultation and fit in one visit's once the product is chosen and fitted, just before the after
// photographs.
//
// Three pages under the one step. The fit spec first. Then the consent the history needs, which the client gives or
// declines apart from everything else, on words the phone shows them word for word; a client who agreed to these
// words before is not asked again, and may withdraw at any visit, which deletes their history. Then the history, only
// once they have agreed. Each page starts from the client's profile as it stands, or from what the API refused, and
// the step sends the profile whole: each version is the profile as it was then.
//
// Figures are typed, to one decimal, and checked against the API's ranges before Next takes them. Everything else is
// one tap, and a second tap on what is chosen takes it off.

import { useId, useState } from "react";
import type { FitSpec, HairProfile, History, Job, ProfileRequest } from "../api.ts";
import { job as jobCopy, profile as copy, steps as stepsCopy } from "../content.ts";
import { dayMonth, todayInIndia } from "../lib/when.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import {
  agreedTo,
  bodyOf,
  DENSITIES,
  FIRST_TRANSPLANT_YEAR,
  fitFormOf,
  fitOf,
  GREY_PERCENT,
  historyFormOf,
  historyOf,
  MEASUREMENTS,
  toggleRemedy,
  typedFigures,
  yearOf,
  type Answer,
  type Choices,
  type FitForm,
  type HistoryForm,
  type Measurement,
} from "./profile-form.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

type Page = "fit" | "consent" | "history";

interface Option<T> {
  readonly id: T;
  readonly label: string;
}

const HEAD: readonly Measurement[] = [
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
];
const BASE: readonly Measurement[] = ["base_width_in", "base_length_in"];

/** A list's choices in the order its words are written, each code with its words. */
function optionsOf<K extends string>(labels: Readonly<Record<K, string>>): Option<K>[] {
  return (Object.keys(labels) as K[]).map((id) => ({ id, label: labels[id] }));
}

const DENSITY_OPTIONS = DENSITIES.map((id) => ({ id, label: copy.densities[id] }));

/** The products the card offers, and the one the profile names if it is no longer offered, so it can be seen. */
function productOptions(job: Job, latest: HairProfile | null): Option<string>[] {
  const offered = job.products.map((product) => ({ id: product.tier, label: product.name }));
  const kept = latest?.fit.product ?? null;
  if (kept === null || offered.some((option) => option.id === kept)) return offered;
  return [...offered, { id: kept, label: latest?.fit.product_name ?? kept }];
}

/** Where the form starts: what the API refused, being put right, else the client's profile as it stands. */
function startingPoint(job: Job, refused: Queued | null): { fit: FitSpec | null; history: History | null } {
  const sent = (refused?.body ?? null) as ProfileRequest | null;
  if (sent !== null) return { fit: sent.fit, history: sent.health?.consent === "given" ? sent.health : null };
  const latest = job.profile?.latest ?? null;
  return { fit: latest?.fit ?? null, history: latest?.history ?? null };
}

/** A list of choices under its title, one tap each. */
function Chips<T extends string | number>({
  title,
  options,
  isChosen,
  onChoose,
}: {
  title: string;
  options: readonly Option<T>[];
  isChosen: (id: T) => boolean;
  onChoose: (id: T) => void;
}) {
  const titleId = useId();
  return (
    <section className={styles.field} aria-labelledby={titleId}>
      <h2 className={styles.fieldTitle} id={titleId}>
        {title}
      </h2>
      <div className={styles.chips}>
        {options.map((option) => (
          <button
            key={option.id}
            className={isChosen(option.id) ? styles.chipOn : styles.chip}
            type="button"
            aria-pressed={isChosen(option.id)}
            onClick={() => {
              onChoose(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** One figure, typed, with the range it must be in said beneath it while it is not. */
function Figure({
  label,
  value,
  invalid,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  hint: string;
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.figure}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        className={styles.box64}
        id={id}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {invalid && (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function FitFields({
  form,
  products,
  onChange,
}: {
  form: FitForm;
  products: readonly Option<string>[];
  onChange: (form: FitForm) => void;
}) {
  const typed = typedFigures(form.figures);
  const headId = useId();
  const baseId = useId();
  const choose =
    <K extends keyof Choices>(key: K) =>
    (id: NonNullable<Choices[K]>) => {
      onChange({ ...form, choices: { ...form.choices, [key]: form.choices[key] === id ? null : id } });
    };
  const chosen =
    <K extends keyof Choices>(key: K) =>
    (id: NonNullable<Choices[K]>) =>
      form.choices[key] === id;
  const figure = (key: Measurement) => (
    <Figure
      key={key}
      label={copy.measurements[key]}
      value={form.figures[key]}
      invalid={typed[key] === "invalid"}
      hint={copy.range(MEASUREMENTS[key].min, MEASUREMENTS[key].max)}
      onChange={(text) => {
        onChange({ ...form, figures: { ...form.figures, [key]: text } });
      }}
    />
  );

  return (
    <>
      <Chips
        title={copy.sections.stage}
        options={optionsOf(copy.stages)}
        isChosen={chosen("norwood_stage")}
        onChoose={choose("norwood_stage")}
      />
      <section className={styles.field} aria-labelledby={headId}>
        <h2 className={styles.fieldTitle} id={headId}>
          {copy.sections.head}
        </h2>
        <div className={styles.figures}>{HEAD.map(figure)}</div>
      </section>
      <section className={styles.field} aria-labelledby={baseId}>
        <h2 className={styles.fieldTitle} id={baseId}>
          {copy.sections.base}
        </h2>
        <div className={styles.figures}>{BASE.map(figure)}</div>
      </section>
      <Chips
        title={copy.sections.colour}
        options={optionsOf(copy.colours)}
        isChosen={chosen("colour")}
        onChoose={choose("colour")}
      />
      <div className={styles.field}>
        <Figure
          label={copy.sections.grey}
          value={form.figures.grey_percent}
          invalid={typed.grey_percent === "invalid"}
          hint={copy.greyRange(GREY_PERCENT.min, GREY_PERCENT.max)}
          onChange={(text) => {
            onChange({ ...form, figures: { ...form.figures, grey_percent: text } });
          }}
        />
      </div>
      <Chips
        title={copy.sections.density}
        options={DENSITY_OPTIONS}
        isChosen={chosen("density_percent")}
        onChoose={choose("density_percent")}
      />
      <Chips
        title={copy.sections.wave}
        options={optionsOf(copy.waves)}
        isChosen={chosen("wave")}
        onChoose={choose("wave")}
      />
      <Chips
        title={copy.sections.hairline}
        options={optionsOf(copy.hairlines)}
        isChosen={chosen("hairline")}
        onChoose={choose("hairline")}
      />
      {products.length > 0 && (
        <Chips
          title={copy.sections.product}
          options={products}
          isChosen={chosen("product")}
          onChoose={choose("product")}
        />
      )}
      <Chips
        title={copy.sections.attachment}
        options={optionsOf(copy.attachments)}
        isChosen={chosen("attachment")}
        onChoose={choose("attachment")}
      />
    </>
  );
}

/** The client's answer to the consent, under the words they are shown. */
function ConsentFields({ answer, onAnswer }: { answer: Answer | null; onAnswer: (answer: Answer) => void }) {
  const answers: Option<Answer>[] = [
    { id: "agrees", label: copy.health.agrees },
    { id: "declines", label: copy.health.declines },
    { id: "not_asked", label: copy.health.notAsked },
  ];
  return (
    <>
      <section className={styles.field} aria-labelledby="health-notice">
        <h2 className={styles.fieldTitle} id="health-notice">
          {copy.health.showClient}
        </h2>
        {copy.health.notice.lines.map((line) => (
          <p className={styles.noticeLine} key={line}>
            {line}
          </p>
        ))}
      </section>
      <section className={styles.field} aria-labelledby="health-answer">
        <h2 className={styles.fieldTitle} id="health-answer">
          {copy.health.answer}
        </h2>
        <div className={styles.choiceList}>
          {answers.map((option) => (
            <button
              key={option.id}
              className={answer === option.id ? styles.choiceOn : styles.choice}
              type="button"
              aria-pressed={answer === option.id}
              onClick={() => {
                onAnswer(option.id);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {answer === "declines" && <p className={styles.note}>{copy.health.declinedNote}</p>}
      </section>
    </>
  );
}

function HistoryFields({
  form,
  thisYear,
  onChange,
}: {
  form: HistoryForm;
  thisYear: number;
  onChange: (form: HistoryForm) => void;
}) {
  const skinId = useId();
  return (
    <>
      <Chips
        title={copy.health.remedies}
        options={optionsOf(copy.remedies)}
        isChosen={(id) => form.remedies.includes(id)}
        onChoose={(id) => {
          onChange({ ...form, remedies: toggleRemedy(form.remedies, id) });
        }}
      />
      {form.remedies.includes("transplant") && (
        <div className={styles.field}>
          <Figure
            label={copy.health.year}
            value={form.year}
            invalid={yearOf(form, thisYear) === "invalid"}
            hint={copy.yearRange(FIRST_TRANSPLANT_YEAR, thisYear)}
            onChange={(year) => {
              onChange({ ...form, year });
            }}
          />
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={skinId}>
          {copy.health.skin}
        </label>
        <input
          className={styles.box64}
          id={skinId}
          value={form.skin}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...form, skin: event.target.value });
          }}
        />
      </div>
    </>
  );
}

/** The step once the job is in hand: each page starts from the client's profile, so they are made with it. */
function ProfileForm({
  job,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  onFinish: (body: ProfileRequest) => void;
  onBack: () => void;
}) {
  const { version } = copy.health.notice;
  const consent = job.profile?.health_consent ?? null;
  const onFile = agreedTo(consent, version);
  const start = startingPoint(job, refused);
  const thisYear = Number(todayInIndia().slice(0, 4));
  const [page, setPage] = useState<Page>("fit");
  const [fit, setFit] = useState<FitForm>(() => fitFormOf(start.fit));
  const [answer, setAnswer] = useState<Answer | null>(onFile ? "agrees" : null);
  // Shown only once the client has agreed, so it may start from what was recorded or refused before.
  const [history, setHistory] = useState<HistoryForm>(() => historyFormOf(start.history));
  const [withdrawn, setWithdrawn] = useState(false);

  const spec = fitOf(fit);
  const answered = historyOf(history, thisYear);
  const notice = refused === null ? null : stepsCopy.corrected.other;
  const agreedAt = onFile ? (consent?.at ?? null) : null;
  const finish = (chosen: Answer) => {
    if (spec === null) return;
    const given = answered ?? { remedies: [], transplant_year: null, skin_and_allergies: null };
    onFinish(bodyOf(spec, { answer: chosen, history: given, version }));
  };

  if (page === "fit") {
    return (
      <StepFrame
        key="fit"
        title={stepsCopy.titles.profile}
        action={stepsCopy.next}
        ready={spec !== null}
        unfinished={copy.checkFigures}
        notice={notice}
        onBack={onBack}
        onAction={() => {
          setPage(onFile ? "history" : "consent");
        }}
      >
        <FitFields form={fit} products={productOptions(job, job.profile?.latest ?? null)} onChange={setFit} />
      </StepFrame>
    );
  }

  if (page === "consent") {
    return (
      <StepFrame
        key="consent"
        title={copy.health.title}
        action={stepsCopy.next}
        ready={answer !== null}
        unfinished={copy.health.chooseAnswer}
        onBack={() => {
          setPage("fit");
        }}
        onAction={() => {
          if (answer === "agrees") setPage("history");
          else if (answer !== null) finish(answer);
        }}
      >
        <ConsentFields answer={answer} onAnswer={setAnswer} />
      </StepFrame>
    );
  }

  return (
    <StepFrame
      key="history"
      title={copy.health.title}
      action={stepsCopy.next}
      ready={withdrawn || answered !== null}
      unfinished={copy.checkFigures}
      onBack={() => {
        setPage(onFile ? "fit" : "consent");
      }}
      onAction={() => {
        finish(withdrawn ? "declines" : "agrees");
      }}
    >
      {agreedAt !== null && (
        <p className={styles.note}>{copy.health.given(dayMonth(todayInIndia(new Date(agreedAt))))}</p>
      )}
      {!withdrawn && <HistoryFields form={history} thisYear={thisYear} onChange={setHistory} />}
      {onFile && (
        <div className={styles.field}>
          <button
            className={withdrawn ? styles.choiceOn : styles.choice}
            type="button"
            aria-pressed={withdrawn}
            onClick={() => {
              setWithdrawn(!withdrawn);
            }}
          >
            {copy.health.withdraw}
          </button>
          {withdrawn && <p className={styles.note}>{copy.health.withdrawnNote}</p>}
        </div>
      )}
    </StepFrame>
  );
}

export function Profile({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "profile");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;
  return (
    <ProfileForm
      key={loaded.value.id}
      job={loaded.value}
      refused={refused}
      onFinish={(body) => void finish(body)}
      onBack={back}
    />
  );
}
