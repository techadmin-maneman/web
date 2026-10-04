// Making discount codes (docs/decisions/0108-discount-codes.md): one code ops type, or codes generated, one or a
// batch of single-use codes; what each takes off, a percentage with an optional cap or an amount, both before GST;
// what it covers; and its limits. No board draws it, so it is laid out as Blackout days is. Every box holds text until
// it is sent, and rupees become paise only then.
//
// Nothing is made until ops have read what will be: the check lists the code or how many, what each takes off, what
// it covers and its limits, and only the second press makes them, as a price is set
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState, type ReactNode } from "react";
import { isCodeText } from "../../../../src/policy/discount-codes.ts";
import { api, type DiscountCodesNew } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.discountCodes;

type Kind = DiscountCodesNew["kind"];
type Covered = DiscountCodesNew["covers"][number];

/** What a code may cover, in the order the form offers them. */
const COVERS: readonly Covered[] = ["first_fit", "service", "replacement"];

interface Draft {
  readonly how: "typed" | "generated";
  readonly code: string;
  readonly count: string;
  readonly kind: Kind;
  /** Per cent for a percentage; rupees for an amount. */
  readonly value: string;
  /** Rupees. */
  readonly cap: string;
  readonly covers: readonly Covered[];
  readonly expiresOn: string;
  readonly maxUses: string;
  readonly oncePerClient: boolean;
}

const EMPTY: Draft = {
  how: "typed",
  code: "",
  count: "1",
  kind: "percent",
  value: "",
  cap: "",
  covers: [],
  expiresOn: "",
  maxUses: "",
  oncePerClient: true,
};

const paise = (rupeesTyped: string): number => Math.round(Number(rupeesTyped) * 100);

/** A box left empty is a limit left out. */
const optional = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** More than one generated: a batch, each code single-use. */
const isBatch = (draft: Draft): boolean => draft.how === "generated" && Number(draft.count) > 1;

/** How many bookings each code may be on: one each for a batch, else what was typed, if anything. */
function usesOf(draft: Draft): { max_uses?: number } {
  if (isBatch(draft)) return { max_uses: 1 };
  const typed = optional(draft.maxUses);
  return typed === null ? {} : { max_uses: Number(typed) };
}

/** What the form sends: numbers and paise from its text. */
function requestOf(draft: Draft): DiscountCodesNew {
  const cap = optional(draft.cap);
  const expiresOn = optional(draft.expiresOn);
  return {
    ...(draft.how === "typed" ? { code: draft.code.trim() } : { count: Number(draft.count) }),
    kind: draft.kind,
    value: draft.kind === "percent" ? Number(draft.value) : paise(draft.value),
    ...(draft.kind === "percent" && cap !== null ? { cap: paise(cap) } : {}),
    covers: [...draft.covers],
    ...(expiresOn === null ? {} : { expires_on: expiresOn }),
    ...usesOf(draft),
    once_per_client: draft.oncePerClient,
  };
}

/** A typed code that cannot be one, said beside its box before anything is checked; null while it can. */
const codeError = (draft: Draft): string | null =>
  draft.how === "typed" && draft.code.trim() !== "" && !isCodeText(draft.code)
    ? (copy.errors.code ?? copy.codeHint)
    : null;

/** Whether every box the code needs is filled in: the rest the API checks, and names the box it refuses. */
function isReady(draft: Draft): boolean {
  const named = draft.how === "typed" ? draft.code.trim() !== "" : draft.count.trim() !== "";
  return named && codeError(draft) === null && draft.value.trim() !== "" && draft.covers.length > 0;
}

/** The check's first line: the code typed, or how many are generated. */
function madeLine(draft: Draft): string {
  if (draft.how === "typed") return copy.oneTyped(draft.code.trim().toUpperCase());
  return isBatch(draft) ? copy.manyGenerated(Number(draft.count)) : copy.oneGenerated;
}

/** What each code takes off, as the check says it: "10%, at most Rs. 500", or "Rs. 1,000". */
function offWords(sent: DiscountCodesNew): string {
  if (sent.kind === "amount") return rupees(sent.value);
  const cap = sent.cap ?? null;
  return copy.percentOff(sent.value, cap === null ? null : rupees(cap));
}

/** The check's lines: what is made, what each takes off, on what, until when, and how often. */
function checkLines(draft: Draft, sent: DiscountCodesNew): string[] {
  const covered = sent.covers.map((kind) => copy.coverNames[kind] ?? kind).join("; ");
  const lastDay = sent.expires_on ?? null;
  return [
    madeLine(draft),
    copy.off(offWords(sent)),
    copy.covering(covered),
    copy.until(lastDay === null ? null : shortDate(lastDay)),
    copy.usesLine(sent.max_uses ?? null, sent.once_per_client),
  ];
}

type Step =
  | { readonly step: "editing" }
  | { readonly step: "checking" | "sending"; readonly sent: DiscountCodesNew }
  | { readonly step: "made"; readonly codes: readonly string[] }
  | { readonly step: "failed"; readonly failure: Failure };

/** The id of a box's hint, which the box is described by. */
const hintOf = (id: string) => `${id}-hint`;

function Field(props: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  const error = props.error ?? null;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.hint !== undefined && (
        <p className={error === null ? styles.hint : styles.fieldError} id={hintOf(props.id)}>
          {error ?? props.hint}
        </p>
      )}
    </div>
  );
}

export function DiscountCodeForm({ today, most, onMade }: { today: string; most: number; onMade: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState<Step>({ step: "editing" });

  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setStep({ step: "editing" });
  };
  const toggle = (kind: Covered) => {
    const covered = draft.covers.includes(kind);
    edit({ covers: covered ? draft.covers.filter((each) => each !== kind) : [...draft.covers, kind] });
  };

  const send = async (sent: DiscountCodesNew) => {
    setStep({ step: "sending", sent });
    const answer = await api.makeDiscountCodes(sent);
    if (!answer.ok) {
      setStep({ step: "failed", failure: { code: answer.code, fields: answer.fields } });
      return;
    }
    setDraft(EMPTY);
    setStep({ step: "made", codes: answer.body.codes });
    onMade();
  };

  if (step.step === "checking" || step.step === "sending") {
    return (
      <div className={styles.group}>
        <CheckPanel
          title={copy.checkTitle}
          lines={checkLines(draft, step.sent)}
          send={copy.send}
          sending={copy.sending}
          back={copy.back}
          busy={step.step === "sending"}
          onSend={() => void send(step.sent)}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      </div>
    );
  }

  return (
    <form
      className={styles.group}
      aria-label={copy.make}
      onSubmit={(event) => {
        event.preventDefault();
        setStep({ step: "checking", sent: requestOf(draft) });
      }}
    >
      <div className={styles.fields}>
        <Field id="code-how" label={copy.how}>
          <select
            id="code-how"
            className={styles.select}
            value={draft.how}
            onChange={(event) => {
              edit({ how: event.target.value === "generated" ? "generated" : "typed" });
            }}
          >
            <option value="typed">{copy.typed}</option>
            <option value="generated">{copy.generated}</option>
          </select>
        </Field>
        {draft.how === "typed" ? (
          <Field id="code-text" label={copy.code} hint={copy.codeHint} error={codeError(draft)}>
            <input
              id="code-text"
              className={styles.text}
              type="text"
              autoCapitalize="characters"
              aria-describedby={hintOf("code-text")}
              aria-invalid={codeError(draft) !== null}
              maxLength={16}
              value={draft.code}
              onChange={(event) => {
                edit({ code: event.target.value });
              }}
            />
          </Field>
        ) : (
          <Field id="code-count" label={copy.count} hint={copy.countHint(most)}>
            <input
              id="code-count"
              className={styles.number}
              type="number"
              aria-describedby={hintOf("code-count")}
              min={1}
              max={most}
              value={draft.count}
              onChange={(event) => {
                edit({ count: event.target.value });
              }}
            />
          </Field>
        )}
      </div>

      <div className={styles.fields}>
        <Field id="code-kind" label={copy.takesOff}>
          <select
            id="code-kind"
            className={styles.select}
            value={draft.kind}
            onChange={(event) => {
              edit({ kind: event.target.value === "amount" ? "amount" : "percent", cap: "" });
            }}
          >
            <option value="percent">{copy.percent}</option>
            <option value="amount">{copy.amount}</option>
          </select>
        </Field>
        <Field id="code-value" label={draft.kind === "percent" ? copy.value : copy.rupeesOff}>
          <input
            id="code-value"
            className={draft.kind === "percent" ? styles.number : `${styles.number ?? ""} ${styles.amount ?? ""}`}
            type="number"
            min={1}
            max={draft.kind === "percent" ? 100 : undefined}
            value={draft.value}
            onChange={(event) => {
              edit({ value: event.target.value });
            }}
          />
        </Field>
        {draft.kind === "percent" && (
          <Field id="code-cap" label={copy.cap} hint={copy.capHint}>
            <input
              id="code-cap"
              className={`${styles.number ?? ""} ${styles.amount ?? ""}`}
              type="number"
              aria-describedby={hintOf("code-cap")}
              min={1}
              value={draft.cap}
              onChange={(event) => {
                edit({ cap: event.target.value });
              }}
            />
          </Field>
        )}
      </div>

      <fieldset className={styles.choices}>
        <legend className={styles.fieldLabel}>{copy.covers}</legend>
        {COVERS.map((kind) => (
          <label key={kind} className={styles.fieldRow}>
            <input
              className={styles.box}
              type="checkbox"
              checked={draft.covers.includes(kind)}
              onChange={() => {
                toggle(kind);
              }}
            />
            {copy.coverNames[kind]}
          </label>
        ))}
      </fieldset>

      <div className={styles.fields}>
        <Field id="code-expires" label={copy.expires} hint={copy.expiresHint}>
          <input
            id="code-expires"
            className={styles.date}
            type="date"
            aria-describedby={hintOf("code-expires")}
            min={today}
            value={draft.expiresOn}
            onChange={(event) => {
              edit({ expiresOn: event.target.value });
            }}
          />
        </Field>
        {!isBatch(draft) && (
          <Field id="code-uses" label={copy.maxUses} hint={copy.maxUsesHint}>
            <input
              id="code-uses"
              className={styles.number}
              type="number"
              aria-describedby={hintOf("code-uses")}
              min={1}
              value={draft.maxUses}
              onChange={(event) => {
                edit({ maxUses: event.target.value });
              }}
            />
          </Field>
        )}
      </div>

      <label className={`${styles.fieldRow} ${styles.once ?? ""}`}>
        <input
          className={styles.box}
          type="checkbox"
          checked={draft.oncePerClient}
          onChange={(event) => {
            edit({ oncePerClient: event.target.checked });
          }}
        />
        {copy.oncePerClient}
      </label>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="small" className={styles.save} disabled={!isReady(draft)}>
          {copy.check}
        </Button>
      </div>
      {step.step === "made" && (
        <p className={styles.saved} role="status">
          {copy.made(step.codes)}
        </p>
      )}
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, step.failure)}
        </p>
      )}
    </form>
  );
}
