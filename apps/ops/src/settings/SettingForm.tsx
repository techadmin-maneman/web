// A setting's form, as every one in the console goes (docs/decisions/0071-what-ops-see-before-a-setting-changes.md):
// its boxes, then a check of what it is now beside what it will be, and only the second press sends it. A refusal
// shows beneath, with the check still up to send again or go back to the boxes.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Fieldset, RefusedBoxes } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import type { Answer } from "@maneman/web-kit/api";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState, type ReactNode } from "react";
import { CheckPanel } from "../components/CheckPanel.tsx";
import form from "../components/forms.module.css";
import { review } from "../content/common.ts";
import { FormRefusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";

/** What a send came to: what to hand on, or the refusal with the boxes it names. */
export type Sent<T> = ({ readonly ok: true } & T) | ({ readonly ok: false } & Failure);

/** An API's answer as a send's: its body made into what to hand on, or its refusal. */
export function sentOf<B, T>(answer: Answer<B>, handOn: (body: B) => T): Sent<T> {
  return answer.ok ? { ok: true, ...handOn(answer.body) } : { ok: false, code: answer.code, fields: answer.fields };
}

interface Steps {
  readonly step: "editing" | "checking" | "saving";
  readonly failed: Failure | null;
  /** Back to the boxes, as a change to any of them goes. */
  readonly edit: () => void;
  readonly check: () => void;
  readonly go: () => void;
}

/** A form's two steps, its boxes and then the check, and what sending it came to; one opened asking starts checking. */
export function useSteps<T>(
  send: () => Promise<Sent<T>>,
  onDone: (sent: { readonly ok: true } & T) => void,
  first: "editing" | "checking" = "editing",
): Steps {
  const [step, setStep] = useState<Steps["step"]>(first);
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

/**
 * The line a refused send leaves beneath its form, but for a refusal its `boxes` say on their own Fields (boxError),
 * which is only announced.
 */
export function Refused(props: {
  readonly failed: Failure | null;
  readonly errors: Readonly<Record<string, string>>;
  readonly boxes?: readonly string[];
}) {
  return <FormRefusal className={form.error} errors={props.errors} failure={props.failed} boxes={props.boxes ?? []} />;
}

/**
 * A one-press action: its button, then its question, sent only by Confirm; Cancel puts the button back. One a row's
 * own button opened starts asking, and its Cancel closes it.
 */
export function ActionCheck<T>(props: {
  /** The button, and what it says to a screen reader where the row names more. */
  readonly label: string;
  readonly ariaLabel?: string;
  readonly question: string;
  readonly lines?: readonly string[];
  readonly warnings?: readonly string[];
  readonly send: () => Promise<Sent<T>>;
  readonly onDone: (sent: { readonly ok: true } & T) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly onCancel?: () => void;
  /** The page's main action, as switching access control on is: its button primary, not quiet. */
  readonly primary?: boolean;
}) {
  const steps = useSteps(props.send, props.onDone, props.onCancel === undefined ? "editing" : "checking");
  return (
    <>
      {steps.step === "editing" ? (
        <FormActions>
          <Button
            variant={props.primary === true ? "primary" : "outline"}
            size="small"
            className={props.primary === true ? undefined : form.quiet}
            aria-label={props.ariaLabel}
            onClick={steps.check}
          >
            {props.label}
          </Button>
        </FormActions>
      ) : (
        <CheckPanel
          question={props.question}
          lines={props.lines}
          warnings={props.warnings}
          busy={steps.step === "saving"}
          onSend={steps.go}
          onBack={props.onCancel ?? steps.edit}
        />
      )}
      <Refused failed={steps.failed} errors={props.errors} />
    </>
  );
}

export function SettingForm(props: {
  readonly title: ReactNode;
  readonly steps: Steps;
  /** Whether the boxes hold something worth checking. */
  readonly ready: boolean;
  readonly errors: Readonly<Record<string, string>>;
  /** Null where there is nothing to go back to, as on the form for a list's first item. */
  readonly onCancel: (() => void) | null;
  /** What the check shows: the setting now beside what it will be. */
  readonly checking: ReactNode;
  /** False where the check finds nothing that changes, so it offers nothing to send. */
  readonly sendable?: boolean;
  /** What stands above the boxes, such as the setting as it is now. */
  readonly above?: ReactNode;
  /** What the last send came to, for a form that stays open after it: "Saved." */
  readonly said?: string | null;
  /** The boxes. */
  readonly children: ReactNode;
  /** The names the API refuses the boxes by, each a Field's `box`, which says its own refusal. */
  readonly boxes?: readonly string[];
}) {
  const { steps } = props;
  return (
    <Fieldset className={form.group} legend={props.title} legendLook="title">
      {props.above}
      <RefusedBoxes.Provider value={(box) => boxError(props.errors, steps.failed, box)}>
        {props.children}
      </RefusedBoxes.Provider>
      {steps.step === "editing" ? (
        <FormActions>
          <Button variant="primary" size="small" disabled={!props.ready} onClick={steps.check}>
            {review.next}
          </Button>
          {props.onCancel !== null && (
            <Button variant="outline" size="small" className={form.quiet} onClick={props.onCancel}>
              {review.cancel}
            </Button>
          )}
        </FormActions>
      ) : (
        <CheckPanel busy={steps.step === "saving"} ready={props.sendable ?? true} onSend={steps.go} onBack={steps.edit}>
          {props.checking}
        </CheckPanel>
      )}
      <Refused failed={steps.failed} errors={props.errors} boxes={props.boxes} />
      {props.said !== undefined && props.said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {props.said}
        </InlineMessage>
      )}
    </Fieldset>
  );
}
