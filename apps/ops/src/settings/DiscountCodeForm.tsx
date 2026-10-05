// Making discount codes (docs/decisions/0108-discount-codes.md): one code ops type, or codes generated, one or a
// batch of single-use codes; what each takes off, a percentage with an optional cap or an amount, both before GST;
// what it covers; and its limits. No board draws it, so it is laid out as Blackout days is. The draft and the check's
// lines are ./discount-draft.ts.
//
// Nothing is made until ops have read what will be: the check lists the code or how many, what each takes off, what
// it covers and its limits, and only the second press makes them, as a price is set
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { classes } from "@maneman/ui/classes";
import { DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { CODE_LENGTH } from "../../../../src/policy/discount-codes.ts";
import { api, type DiscountCodesNew } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
import {
  checkLines,
  codeError,
  COVERS,
  EMPTY,
  isBatch,
  isReady,
  requestOf,
  type Covered,
  type Draft,
} from "./discount-draft.ts";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.discountCodes;

type Step =
  | { readonly step: "editing" }
  | { readonly step: "checking" | "sending"; readonly sent: DiscountCodesNew }
  | { readonly step: "made"; readonly codes: readonly string[] }
  | { readonly step: "failed"; readonly failure: Failure };

/** A change to some of the draft's boxes. */
type Edit = (change: Partial<Draft>) => void;

/** One code ops type, or how many are generated. */
function WhatIsMade({ draft, most, edit }: { draft: Draft; most: number; edit: Edit }) {
  return (
    <div className={styles.fields}>
      <Field label={copy.how} className={styles.field}>
        {(control) => (
          <Select
            {...control}
            className={styles.choiceBox}
            value={draft.how}
            onChange={(event) => {
              edit({ how: event.target.value === "generated" ? "generated" : "typed" });
            }}
          >
            <option value="typed">{copy.typed}</option>
            <option value="generated">{copy.generated}</option>
          </Select>
        )}
      </Field>
      {draft.how === "typed" ? (
        <Field
          label={copy.code}
          hint={codeError(draft) === null ? copy.codeHint : undefined}
          error={codeError(draft)}
          className={styles.field}
        >
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
              autoCapitalize="characters"
              maxLength={CODE_LENGTH.max}
              value={draft.code}
              onChange={(event) => {
                edit({ code: event.target.value });
              }}
            />
          )}
        </Field>
      ) : (
        <Field label={copy.count} hint={copy.countHint(most)} className={styles.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={styles.figureBox}
              min={1}
              max={most}
              value={draft.count}
              onChange={(event) => {
                edit({ count: event.target.value });
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** What each code takes off: a percentage with an optional cap, or an amount. */
function WhatItTakesOff({ draft, edit }: { draft: Draft; edit: Edit }) {
  return (
    <div className={styles.fields}>
      <Field label={copy.takesOff} className={styles.field}>
        {(control) => (
          <Select
            {...control}
            className={styles.choiceBox}
            value={draft.kind}
            onChange={(event) => {
              edit({ kind: event.target.value === "amount" ? "amount" : "percent", cap: "" });
            }}
          >
            <option value="percent">{copy.percent}</option>
            <option value="amount">{copy.amount}</option>
          </Select>
        )}
      </Field>
      <Field label={draft.kind === "percent" ? copy.value : copy.rupeesOff} className={styles.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={draft.kind === "amount" ? styles.amountBox : styles.figureBox}
            min={1}
            max={draft.kind === "percent" ? 100 : undefined}
            value={draft.value}
            onChange={(event) => {
              edit({ value: event.target.value });
            }}
          />
        )}
      </Field>
      {draft.kind === "percent" && (
        <Field label={copy.cap} hint={copy.capHint} className={styles.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={styles.amountBox}
              min={1}
              value={draft.cap}
              onChange={(event) => {
                edit({ cap: event.target.value });
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** What it covers: a box for each kind of visit. */
function Covers({ draft, edit }: { draft: Draft; edit: Edit }) {
  const toggle = (kind: Covered) => {
    const covered = draft.covers.includes(kind);
    edit({ covers: covered ? draft.covers.filter((each) => each !== kind) : [...draft.covers, kind] });
  };
  return (
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
  );
}

/** Its limits: the last day, how many bookings each code may be on, and once per client. */
function Limits({ draft, today, edit }: { draft: Draft; today: string; edit: Edit }) {
  return (
    <>
      <div className={styles.fields}>
        <Field label={copy.expires} hint={copy.expiresHint} className={styles.field}>
          {(control) => (
            <DateInput
              {...control}
              className={styles.dateBox}
              min={today}
              value={draft.expiresOn}
              onChange={(event) => {
                edit({ expiresOn: event.target.value });
              }}
            />
          )}
        </Field>
        {!isBatch(draft) && (
          <Field label={copy.maxUses} hint={copy.maxUsesHint} className={styles.field}>
            {(control) => (
              <NumberInput
                {...control}
                className={styles.figureBox}
                min={1}
                value={draft.maxUses}
                onChange={(event) => {
                  edit({ maxUses: event.target.value });
                }}
              />
            )}
          </Field>
        )}
      </div>

      <label className={classes(styles.fieldRow, styles.once)}>
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
    </>
  );
}

export function DiscountCodeForm({ today, most, onMade }: { today: string; most: number; onMade: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState<Step>({ step: "editing" });

  const edit: Edit = (change) => {
    setDraft({ ...draft, ...change });
    setStep({ step: "editing" });
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
      <WhatIsMade draft={draft} most={most} edit={edit} />
      <WhatItTakesOff draft={draft} edit={edit} />
      <Covers draft={draft} edit={edit} />
      <Limits draft={draft} today={today} edit={edit} />

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
