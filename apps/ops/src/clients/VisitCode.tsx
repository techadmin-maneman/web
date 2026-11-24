// A discount code on one of the client's visits, beneath the visit in the Visits tab's Visit column, as the redesign has
// no column of its own for it (docs/decisions/0108-discount-codes.md). A code goes on or comes off only while the
// visit's price is open (`price_open`), and a consultation takes none. A code the client typed on the site shows
// beneath the visit and starts the box.

import { SubmitButton } from "@maneman/ui/SubmitButton";
import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Field, TextInput } from "@maneman/ui/Field";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Refusal } from "@maneman/ui/Refusal";
import { CancelButton } from "@maneman/ui/CancelButton";
import { errorText } from "@maneman/web-kit/refusal";
import { TextButton } from "@maneman/ui/TextLink";

import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type ClientVisit, type VisitDiscountCode } from "../api.ts";
import { clients } from "../content.ts";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { useAccess } from "../lib/access.ts";
import shared from "./clients.module.css";
import styles from "./visit-code.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.visits.code;

type Step = "showing" | "entering" | "applying" | "removing";

/** The code on a visit, or nothing; one that takes a code and has none shows the way to enter one instead. */
function Shown({ code }: { code: VisitDiscountCode | null }) {
  if (code === null) return null;
  const off = code.amount_off === null ? null : rupees(code.amount_off);
  return (
    <span className={shared.closedLine}>
      {copy.applied(code.code, off)} · {copy.givenBy[code.given_by]}
    </span>
  );
}

/**
 * A visit's code lines together, apart from its name: beneath it, or on a phone's card on a line of their own. Nothing
 * where there is no code and none can be entered.
 */
function CodeLines(props: {
  code: VisitDiscountCode | null;
  requested: string | null;
  when: string;
  mayEnter: boolean;
  mayRemove: boolean;
  removing: boolean;
  onEnter: () => void;
  onRemove: () => void;
}) {
  const { code, requested, when, mayEnter, mayRemove } = props;
  if (code === null && requested === null && !mayEnter) return null;
  return (
    <span className={shared.visitCode}>
      {!(mayEnter && code === null) && <Shown code={code} />}
      {requested !== null && <span className={shared.closedLine}>{copy.requested(requested)}</span>}
      {mayEnter && code === null && (
        <TextButton
          icon={ACTION_ICONS.ticketPercent}
          compact
          className={shared.rowAction}
          aria-label={copy.enterLabel(when)}
          onClick={props.onEnter}
        >
          {copy.enter}
        </TextButton>
      )}
      {mayRemove && code !== null && (
        <TextButton
          icon={ACTION_ICONS.x}
          compact
          className={shared.rowAction}
          aria-label={copy.removeLabel(when)}
          disabled={props.removing}
          onClick={props.onRemove}
        >
          {props.removing ? copy.removing : copy.remove}
        </TextButton>
      )}
    </span>
  );
}

/** A refusal in the console's words. */
const said = (code: string): string => errorText(copy.errors, { code });

export function VisitCode({ visit }: { visit: ClientVisit }) {
  const [code, setCode] = useState<VisitDiscountCode | null>(visit.discount_code);
  const [step, setStep] = useState<Step>("showing");
  const [typed, setTyped] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const access = useAccess();
  const when = plainDate(visit.date);
  const takesACode = visit.price_open && visit.type !== null && visit.type !== "consultation";
  const mayEnter = takesACode && access.mayCall("POST /api/visits/{id}/discount-code");
  const mayRemove = visit.price_open && access.mayCall("POST /api/visits/{id}/discount-code/remove");

  const apply = async () => {
    setStep("applying");
    const answer = await clientsApi.enterVisitCode(visit.id, typed.trim());
    if (!answer.ok) {
      setFailure(said(answer.code));
      setStep("entering");
      return;
    }
    setCode(answer.body);
    setTyped("");
    setStep("showing");
  };

  const remove = async () => {
    setStep("removing");
    const answer = await clientsApi.removeVisitCode(visit.id);
    setStep("showing");
    if (!answer.ok) {
      setFailure(said(answer.code));
      return;
    }
    setCode(null);
  };

  const problem = failure !== null && <Refusal said={failure} />;

  const stopEntering = () => {
    setStep("showing");
    setFailure(null);
  };
  const entering = (step === "entering" || step === "applying") && (
    <FormDrawer title={copy.drawerTitle(when)} onClose={stopEntering}>
      <form
        className={styles.codeForm}
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <Field label={copy.label} labelHidden error={failure} announce look={{ error: styles.codeError }}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.codeInput}
              autoCapitalize="characters"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setFailure(null);
              }}
            />
          )}
        </Field>
        <SubmitButton disabled={typed.trim() === "" || step === "applying"}>
          {step === "applying" ? copy.applying : copy.apply}
        </SubmitButton>
        <CancelButton disabled={step === "applying"} onClick={stopEntering} />
      </form>
    </FormDrawer>
  );

  const requested = code === null ? visit.requested_code : null;
  return (
    <>
      <CodeLines
        code={code}
        requested={requested}
        when={when}
        mayEnter={mayEnter}
        mayRemove={mayRemove}
        removing={step === "removing"}
        onEnter={() => {
          setTyped(requested ?? "");
          setStep("entering");
        }}
        onRemove={() => void remove()}
      />
      {problem}
      {entering}
    </>
  );
}
