// A setting's form, as every one in the console goes (docs/decisions/0071-what-ops-see-before-a-setting-changes.md):
// its boxes, then a check of what it is now beside what it will be, and only the second press sends it. A refusal
// shows beneath, with the check still up to send again or go back to the boxes.

import { Button } from "@maneman/ui/Button";
import type { Answer } from "@maneman/web-kit/api";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState, type ReactNode } from "react";
import { CheckPanel } from "../components/CheckPanel.tsx";
import styles from "../components/forms.module.css";

/** What a send came to: what to hand on, or the refusal with the boxes it names. */
export type Sent<T> = ({ readonly ok: true } & T) | ({ readonly ok: false } & Failure);

/** An API's answer as a send's: its body made into what to hand on, or its refusal. */
export function sentOf<B, T>(answer: Answer<B>, handOn: (body: B) => T): Sent<T> {
  return answer.ok ? { ok: true, ...handOn(answer.body) } : { ok: false, code: answer.code, fields: answer.fields };
}

export interface Steps {
  readonly step: "editing" | "checking" | "saving";
  readonly failed: Failure | null;
  /** Back to the boxes, as a change to any of them goes. */
  readonly edit: () => void;
  readonly check: () => void;
  readonly go: () => void;
}

/** A form's two steps, its boxes and then the check, and what sending it came to. */
export function useSteps<T>(send: () => Promise<Sent<T>>, onDone: (sent: { readonly ok: true } & T) => void): Steps {
  const [step, setStep] = useState<Steps["step"]>("editing");
  const [failed, setFailed] = useState<Failure | null>(null);
  const edit = () => {
    setStep("editing");
    setFailed(null);
  };
  const go = async () => {
    setStep("saving");
    const sent = await send();
    if (sent.ok) {
      onDone(sent);
      return;
    }
    setFailed(sent);
    setStep("checking");
  };
  return {
    step,
    failed,
    edit,
    check: () => {
      setStep("checking");
    },
    go: () => void go(),
  };
}

/** The words of a form's buttons and its check. */
export interface FormWords {
  readonly next: string;
  readonly cancel: string;
  readonly checkTitle: string;
  readonly send: string;
  readonly saving: string;
  readonly back: string;
}

/** The line a refused send leaves beneath its form. */
export function Refused(props: { readonly failed: Failure | null; readonly errors: Readonly<Record<string, string>> }) {
  if (props.failed === null) return null;
  return (
    <p className={styles.error} role="alert">
      {errorText(props.errors, props.failed)}
    </p>
  );
}

export function SettingForm(props: {
  readonly title: ReactNode;
  readonly steps: Steps;
  /** Whether the boxes hold something worth checking. */
  readonly ready: boolean;
  readonly words: FormWords;
  readonly errors: Readonly<Record<string, string>>;
  /** Null where there is nothing to go back to, as on the form for a list's first item. */
  readonly onCancel: (() => void) | null;
  /** What the check shows: the setting now beside what it will be. */
  readonly checking: ReactNode;
  /** False where the check finds nothing that changes, so it offers nothing to send. */
  readonly sendable?: boolean;
  /** What stands above the boxes, such as the setting as it is now. */
  readonly above?: ReactNode;
  /** The boxes. */
  readonly children: ReactNode;
}) {
  const { steps, words } = props;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{props.title}</legend>
      {props.above}
      {props.children}
      {steps.step === "editing" ? (
        <div className={styles.actions}>
          <Button variant="primary" size="small" className={styles.save} disabled={!props.ready} onClick={steps.check}>
            {words.next}
          </Button>
          {props.onCancel !== null && (
            <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
              {words.cancel}
            </Button>
          )}
        </div>
      ) : (
        <CheckPanel
          title={words.checkTitle}
          send={words.send}
          sending={words.saving}
          back={words.back}
          busy={steps.step === "saving"}
          ready={props.sendable ?? true}
          onSend={steps.go}
          onBack={steps.edit}
        >
          {props.checking}
        </CheckPanel>
      )}
      <Refused failed={steps.failed} errors={props.errors} />
    </fieldset>
  );
}
