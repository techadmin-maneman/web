// Retiring a consumable from a day, or restoring one retired
// (docs/decisions/0087-consumables-and-stock.md). The technician app stops
// offering it from that day; nothing already recorded moves, and neither does
// its stock. The check says so before anything is sent (ADR 0071).

import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.consumables;
const words = copy.retiring;

type Step = { readonly step: "editing" | "checking" | "saving" } | ({ readonly step: "failed" } & Failure);

export function Retirement({
  consumable,
  today,
  restoring,
  onSaved,
  onCancel,
}: {
  consumable: Consumable;
  today: string;
  /** True to offer a retired one again; false to retire one offered. */
  restoring: boolean;
  onSaved: (book: Consumables, said: string) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(today);
  const [step, setStep] = useState<Step>({ step: restoring ? "checking" : "editing" });
  const id = `retire-${consumable.code}`;

  const send = async () => {
    setStep({ step: "saving" });
    const answer = restoring
      ? await api.restoreConsumable(consumable.code)
      : await api.retireConsumable(consumable.code, from);
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onSaved(answer.body, words.done);
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>
        {restoring ? copy.restoreLabel(consumable.name) : words.title(consumable.name)}
      </legend>
      {!restoring && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={id}>
              {words.from}
            </label>
            <input
              className={styles.date}
              id={id}
              type="date"
              min={today}
              value={from}
              aria-describedby={`${id}-hint`}
              onChange={(event) => {
                setFrom(event.target.value);
                setStep({ step: "editing" });
              }}
            />
            <p className={styles.hint} id={`${id}-hint`}>
              {words.fromHint}
            </p>
          </div>
        </div>
      )}
      {step.step === "editing" ? (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            disabled={from === ""}
            onClick={() => {
              setStep({ step: "checking" });
            }}
          >
            {words.send}
          </Button>
          <Button variant="outline" size="small" className={styles.quiet} onClick={onCancel}>
            {copy.form.cancel}
          </Button>
        </div>
      ) : (
        <CheckPanel
          title={copy.form.confirm.title}
          lines={[restoring ? words.restore(consumable.name) : words.question(consumable.name, longDate(from))]}
          send={restoring ? words.restoreSend : words.send}
          sending={copy.form.saving}
          back={copy.form.confirm.back}
          busy={step.step === "saving"}
          onSend={() => void send()}
          onBack={
            restoring
              ? onCancel
              : () => {
                  setStep({ step: "editing" });
                }
          }
        />
      )}
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, step)}
        </p>
      )}
    </fieldset>
  );
}
