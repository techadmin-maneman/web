// Retiring a consumable from a day, or restoring one retired
// (docs/decisions/0087-consumables-and-stock.md). The technician app stops
// offering it from that day; nothing already recorded moves, and neither does
// its stock. The check says so before anything is sent (ADR 0071).

import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Answer, type Consumable, type Consumables } from "../api.ts";
import { settings } from "../content.ts";
import { CheckPanel } from "./CheckPanel.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.consumables;
const words = copy.retiring;

type Step = { readonly step: "editing" | "checking" | "saving" } | ({ readonly step: "failed" } & Failure);

interface Props {
  readonly consumable: Consumable;
  readonly onSaved: (book: Consumables, said: string) => void;
  readonly onCancel: () => void;
}

/** The change sent, and the consumables as they stand once it is made; a refusal stays on the panel. */
function useSend(first: Step, onSaved: Props["onSaved"]) {
  const [step, setStep] = useState<Step>(first);
  const send = async (call: () => Promise<Answer<Consumables>>) => {
    setStep({ step: "saving" });
    const answer = await call();
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onSaved(answer.body, words.done);
  };
  return [step, setStep, send] as const;
}

function Refused({ step }: { step: Step }) {
  if (step.step !== "failed") return null;
  return (
    <p className={styles.error} role="alert">
      {refusalOf(copy.errors, step)}
    </p>
  );
}

/** A retired consumable offered again: nothing to fill in, so the check is all there is. */
export function Restoring({ consumable, onSaved, onCancel }: Props) {
  const [step, , send] = useSend({ step: "checking" }, onSaved);
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{copy.restoreLabel(consumable.name)}</legend>
      <CheckPanel
        title={copy.form.confirm.title}
        lines={[words.restore(consumable.name)]}
        send={words.restoreSend}
        sending={copy.form.saving}
        back={copy.form.confirm.back}
        busy={step.step === "saving"}
        onSend={() => void send(() => api.restoreConsumable(consumable.code))}
        onBack={onCancel}
      />
      <Refused step={step} />
    </fieldset>
  );
}

/** An offered consumable retired from a day, which the check names before anything is sent. */
export function Retiring({ consumable, today, onSaved, onCancel }: Props & { readonly today: string }) {
  const [from, setFrom] = useState(today);
  const [step, setStep, send] = useSend({ step: "editing" }, onSaved);
  const id = `retire-${consumable.code}`;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{words.title(consumable.name)}</legend>
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
          lines={[words.question(consumable.name, longDate(from))]}
          send={words.send}
          sending={copy.form.saving}
          back={copy.form.confirm.back}
          busy={step.step === "saving"}
          onSend={() => void send(() => api.retireConsumable(consumable.code, from))}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      )}
      <Refused step={step} />
    </fieldset>
  );
}
