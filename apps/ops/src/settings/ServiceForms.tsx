// The forms a service's or a late fee's actions open (./Services.tsx), each shown in the block it acts on. Every one
// shows what it is now beside what it will be before anything is sent, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A price's boxes start from the price in force, its
// GST included: a GST box that opened at nought once made an 18% item GST-free without anyone seeing it.

import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Kind, type OpsService, type Price, type ServiceBook } from "../api.ts";
import { settings } from "../content.ts";
import { addDays } from "../dispatch/job.ts";
import { CODE, codeOf } from "./code.ts";
import styles from "./settings.module.css";

const copy = settings.services;
const form = copy.form;
const check = copy.check;

/** What a write answered: the book as it now stands, or the refusal, with the boxes it names. */
export type Written =
  | { readonly ok: true; readonly services?: ServiceBook; readonly prices?: readonly Price[]; readonly said: string }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

/** What a price is set for: a service, or a late fee, by the book's item and tier, and the name ops read. */
export interface Priced {
  readonly item: Price["item"];
  readonly tier: string;
  readonly name: string;
  /** Every price it has had and is to have, newest first. */
  readonly prices: readonly Price[];
}

/** "Rs. 2,000 + 18% GST". */
export const priceWords = (price: { amount_ex_gst: number; gst_percent: number }) =>
  copy.price(rupees(price.amount_ex_gst), price.gst_percent);

/** A refusal, said of the box it names where it names one. */
export function refusalOf(
  failure: { readonly code: string; readonly fields: readonly string[] },
  errors: Readonly<Record<string, string>> = copy.errors,
): string {
  const [field] = failure.fields;
  if (failure.code === "invalid_request" && field !== undefined) return errors[field] ?? copy.errors.unknown ?? "";
  return errors[failure.code] ?? copy.errors.unknown ?? "";
}

/**
 * The check before anything is sent: a group named by its title, which takes focus as it opens, so it is read at
 * once and never opens out of sight.
 */
export function Check(props: {
  readonly id: string;
  readonly title?: string;
  readonly children: ReactNode;
  readonly busy: boolean;
  readonly send: string;
  readonly back: string;
  readonly onSend: () => void;
  readonly onBack: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={props.id}>
      <p className={props.title === undefined ? styles.checkLine : styles.checkTitle} id={props.id}>
        {props.title ?? props.children}
      </p>
      {props.title !== undefined && props.children}
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} disabled={props.busy} onClick={props.onSend}>
          {props.busy ? copy.saving : props.send}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={props.busy} onClick={props.onBack}>
          {props.back}
        </Button>
      </div>
    </div>
  );
}

/** A form's two steps: its boxes, then the check; and what sending it came to. */
function useSteps(send: () => Promise<Written>, onDone: (written: Written & { ok: true }) => void) {
  const [step, setStep] = useState<"editing" | "checking" | "saving">("editing");
  const [failed, setFailed] = useState<(Written & { ok: false }) | null>(null);
  const edit = () => {
    setStep("editing");
    setFailed(null);
  };
  const go = async () => {
    setStep("saving");
    const written = await send();
    if (written.ok) {
      onDone(written);
      return;
    }
    setFailed(written);
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

/** The line a refused send leaves beneath its form. */
function Refused({ failed }: { failed: { code: string; fields: readonly string[] } | null }) {
  if (failed === null) return null;
  return (
    <p className={styles.error} role="alert">
      {refusalOf(failed)}
    </p>
  );
}

/** A box with its label above and its hint beneath, the hint read with it. */
function Box(props: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly children: (describedBy: string) => ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      {props.children(`${props.id}-hint`)}
      <p className={styles.hint} id={`${props.id}-hint`}>
        {props.hint}
      </p>
    </div>
  );
}

function FormButtons(props: { readonly ready: boolean; readonly onNext: () => void; readonly onCancel: () => void }) {
  return (
    <div className={styles.actions}>
      <Button variant="primary" size="small" className={styles.save} disabled={!props.ready} onClick={props.onNext}>
        {form.next}
      </Button>
      <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
        {form.cancel}
      </Button>
    </div>
  );
}

/**
 * A new price from a day, tomorrow at the earliest, or, given `correcting`, the price still to come it corrects: taken
 * back and set again, in one go. The boxes start from the price in force, or the one corrected.
 */
export function PriceForm(props: {
  readonly target: Priced;
  readonly correcting?: Price;
  readonly today: string;
  readonly maxAmount: number;
  readonly maxGst: number;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { target, correcting, today } = props;
  const inForce = target.prices.find((price) => price.in_force);
  const start = correcting ?? inForce;
  const [rupeesTyped, setRupees] = useState(start === undefined ? "" : String(start.amount_ex_gst / 100));
  const [gst, setGst] = useState(start === undefined ? "" : String(start.gst_percent));
  const firstDay = addDays(today, 1);
  const [from, setFrom] = useState(correcting?.valid_from ?? firstDay);
  const key = `${target.item}-${target.tier}`;
  // Rupees on the screen, paise in the book: the API and the database count in paise.
  const change = {
    item: target.item,
    tier: target.tier,
    amount_ex_gst: Math.round(Number(rupeesTyped) * 100),
    gst_percent: Number(gst),
    valid_from: from,
  };
  const steps = useSteps(async () => {
    const answer =
      correcting === undefined
        ? await api.setPrice(change)
        : await api.correctPrice({ ...change, was_valid_from: correcting.valid_from });
    return answer.ok
      ? { ok: true, prices: answer.body.prices, said: copy.done.price }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const ready = rupeesTyped.trim() !== "" && gst.trim() !== "" && from !== "";
  const was = correcting ?? inForce;
  const sameDay = target.prices.some(
    (price) => price.valid_from === change.valid_from && price.valid_from !== correcting?.valid_from,
  );

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>
        {correcting === undefined
          ? form.priceTitle(target.name)
          : form.correctTitle(target.name, longDate(correcting.valid_from))}
      </legend>
      {inForce !== undefined && correcting === undefined && (
        <p className={styles.formNow}>{copy.now(priceWords(inForce), longDate(inForce.valid_from))}</p>
      )}
      <div className={styles.fields}>
        <Box id={`price-amount-${key}`} label={form.amount} hint={form.amountHint(rupees(props.maxAmount))}>
          {(hint) => (
            <input
              className={`${styles.number ?? ""} ${styles.amount ?? ""}`}
              id={`price-amount-${key}`}
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={props.maxAmount / 100}
              value={rupeesTyped}
              aria-describedby={hint}
              onChange={(event) => {
                setRupees(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
        <Box id={`price-gst-${key}`} label={form.gst} hint={form.gstHint(props.maxGst)}>
          {(hint) => (
            <div className={styles.fieldRow}>
              <input
                className={styles.number}
                id={`price-gst-${key}`}
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                max={props.maxGst}
                value={gst}
                aria-describedby={hint}
                onChange={(event) => {
                  setGst(event.target.value);
                  steps.edit();
                }}
              />
              <span className={styles.unit}>%</span>
            </div>
          )}
        </Box>
        <Box id={`price-from-${key}`} label={form.from} hint={form.fromHint}>
          {(hint) => (
            <input
              className={styles.date}
              id={`price-from-${key}`}
              type="date"
              min={firstDay}
              value={from}
              aria-describedby={hint}
              onChange={(event) => {
                setFrom(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons ready={ready} onNext={steps.check} onCancel={props.onCancel} />
      ) : (
        <Check
          id={`price-check-${key}`}
          title={check.title}
          busy={steps.step === "saving"}
          send={form.setPrice}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>
            {correcting === undefined
              ? check.price(
                  target.name,
                  was === undefined ? check.nothing : priceWords(was),
                  priceWords(change),
                  longDate(change.valid_from),
                )
              : check.correct(
                  target.name,
                  priceWords(correcting),
                  longDate(correcting.valid_from),
                  priceWords(change),
                  longDate(change.valid_from),
                )}
          </p>
          {was !== undefined && was.gst_percent !== change.gst_percent && (
            <p className={styles.checkWarning}>{check.gstChanges(was.gst_percent, change.gst_percent)}</p>
          )}
          {sameDay && <p className={styles.checkLine}>{check.sameDay}</p>}
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}

/** Taking back a price still to come: asked once, in its block, before anything is sent. */
export function TakeBack(props: {
  readonly target: Priced;
  readonly row: Price;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const { target, row } = props;
  const steps = useSteps(async () => {
    const answer = await api.withdrawPrice({ item: target.item, tier: target.tier, valid_from: row.valid_from });
    return answer.ok
      ? { ok: true, prices: answer.body.prices, said: copy.done.takenBack }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  return (
    <>
      <Check
        id={`take-back-${target.item}-${target.tier}`}
        busy={steps.step === "saving"}
        send={check.takeBackConfirm}
        back={check.keep}
        onSend={steps.go}
        onBack={props.onKeep}
      >
        {check.takeBack(longDate(row.valid_from))}
      </Check>
      {steps.failed !== null && (
        <p className={styles.error} role="alert">
          {refusalOf(steps.failed, { ...copy.errors, ...copy.takeBackErrors })}
        </p>
      )}
    </>
  );
}

/** A service's new name. Its code stays, so its prices, and what was sold under them, stay its own. */
export function RenameForm(props: {
  readonly service: OpsService;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service } = props;
  const [name, setName] = useState(service.name);
  const steps = useSteps(async () => {
    const answer = await api.renameService(service.kind, service.tier, name.trim());
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const id = `rename-${service.kind}-${service.tier}`;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.renameTitle(service.name)}</legend>
      <div className={styles.fields}>
        <Box id={id} label={form.name} hint={form.nameHint}>
          {(hint) => (
            <input
              className={styles.text}
              id={id}
              type="text"
              maxLength={60}
              value={name}
              aria-describedby={hint}
              onChange={(event) => {
                setName(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons
          ready={name.trim() !== "" && name.trim() !== service.name}
          onNext={steps.check}
          onCancel={props.onCancel}
        />
      ) : (
        <Check
          id={`${id}-check`}
          title={check.title}
          busy={steps.step === "saving"}
          send={check.send}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>{check.rename(service.name, name.trim(), service.tier)}</p>
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}

/** The line clients read under a service's name as they choose. Left empty, they read the name alone. */
export function DescribeForm(props: {
  readonly service: OpsService;
  readonly maxLength: number;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service } = props;
  const was = service.description ?? "";
  const [line, setLine] = useState(was);
  const steps = useSteps(async () => {
    const answer = await api.describeService(service.kind, service.tier, line.trim());
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const id = `describe-${service.kind}-${service.tier}`;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.describeTitle(service.name)}</legend>
      <div className={styles.fields}>
        <Box id={id} label={form.description} hint={form.descriptionHint(props.maxLength)}>
          {(hint) => (
            <input
              className={styles.text}
              id={id}
              type="text"
              maxLength={props.maxLength}
              value={line}
              aria-describedby={hint}
              onChange={(event) => {
                setLine(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons ready={line.trim() !== was} onNext={steps.check} onCancel={props.onCancel} />
      ) : (
        <Check
          id={`${id}-check`}
          title={check.title}
          busy={steps.step === "saving"}
          send={check.send}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>{check.describe(service.name, was, line.trim())}</p>
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}

/** How long a service is booked for, from now on, inside the bounds the API gives. */
export function LengthForm(props: {
  readonly service: OpsService;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service, bounds } = props;
  const [minutes, setMinutes] = useState(String(service.minutes));
  const steps = useSteps(async () => {
    const answer = await api.setServiceLength(service.kind, service.tier, Number(minutes));
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const id = `length-${service.kind}-${service.tier}`;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.lengthTitle(service.name)}</legend>
      <div className={styles.fields}>
        <Box id={id} label={form.minutes} hint={form.minutesHint(bounds.min, bounds.max)}>
          {(hint) => (
            <input
              className={styles.number}
              id={id}
              type="number"
              inputMode="numeric"
              step={1}
              min={bounds.min}
              max={bounds.max}
              value={minutes}
              aria-describedby={hint}
              onChange={(event) => {
                setMinutes(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons
          ready={minutes.trim() !== "" && Number(minutes) !== service.minutes}
          onNext={steps.check}
          onCancel={props.onCancel}
        />
      ) : (
        <Check
          id={`${id}-check`}
          title={check.title}
          busy={steps.step === "saving"}
          send={check.send}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>{check.length(service.name, service.minutes, Number(minutes))}</p>
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}

/** Stops offering a service from a day, today or later; the API keeps every kind one service to book. */
export function RetireForm(props: {
  readonly service: OpsService;
  readonly today: string;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service, today } = props;
  const [from, setFrom] = useState(today);
  const steps = useSteps(async () => {
    const answer = await api.retireService(service.kind, service.tier, from);
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const id = `retire-${service.kind}-${service.tier}`;
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.retireTitle(service.name)}</legend>
      <div className={styles.fields}>
        <Box id={id} label={form.retireFrom} hint={form.retireHint}>
          {(hint) => (
            <input
              className={styles.date}
              id={id}
              type="date"
              min={today}
              value={from}
              aria-describedby={hint}
              onChange={(event) => {
                setFrom(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons ready={from !== ""} onNext={steps.check} onCancel={props.onCancel} />
      ) : (
        <Check
          id={`${id}-check`}
          title={check.title}
          busy={steps.step === "saving"}
          send={check.send}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>{check.retire(service.name, longDate(from))}</p>
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}

/** Offers a retired service again, or takes back a retirement still to come: asked once. */
export function RestoreCheck(props: {
  readonly service: OpsService;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const { service } = props;
  const steps = useSteps(async () => {
    const answer = await api.restoreService(service.kind, service.tier);
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  return (
    <>
      <Check
        id={`restore-${service.kind}-${service.tier}`}
        busy={steps.step === "saving"}
        send={check.send}
        back={check.back}
        onSend={steps.go}
        onBack={props.onKeep}
      >
        {check.restore(service.name)}
      </Check>
      <Refused failed={steps.failed} />
    </>
  );
}

/** A kind's services in a new order, shown beside the old before it is sent. */
export function OrderCheck(props: {
  readonly kind: Kind;
  readonly was: readonly OpsService[];
  readonly now: readonly OpsService[];
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const names = (services: readonly OpsService[]) => services.map((service) => service.name).join(", ");
  const steps = useSteps(async () => {
    const answer = await api.orderServices(
      props.kind,
      props.now.map((service) => service.tier),
    );
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  return (
    <>
      <Check
        id={`order-${props.kind}`}
        busy={steps.step === "saving"}
        send={check.send}
        back={check.back}
        onSend={steps.go}
        onBack={props.onKeep}
      >
        {check.order(copy.kinds[props.kind] ?? props.kind, names(props.was), names(props.now))}
      </Check>
      <Refused failed={steps.failed} />
    </>
  );
}

/** A service added to a kind: its name, the code made from it, and its length, which starts at the kind's. */
export function AddForm(props: {
  readonly kind: Kind;
  readonly minutes: number;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { kind, bounds } = props;
  const kindName = copy.kinds[kind] ?? kind;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTyped, setCodeTyped] = useState(false);
  const [minutes, setMinutes] = useState(String(props.minutes));
  const codeSent = codeTyped ? code.trim() : codeOf(name);
  const steps = useSteps(async () => {
    const answer = await api.addService({ kind, name: name.trim(), tier: codeSent, minutes: Number(minutes) });
    return answer.ok
      ? { ok: true, services: answer.body, said: copy.done.saved }
      : { ok: false, code: answer.code, fields: answer.fields };
  }, props.onDone);
  const id = `add-${kind}`;
  const ready = name.trim() !== "" && CODE.test(codeSent) && minutes.trim() !== "";
  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.addTitle(kindName)}</legend>
      <div className={styles.fields}>
        <Box id={`${id}-name`} label={form.name} hint={form.nameHint}>
          {(hint) => (
            <input
              className={styles.text}
              id={`${id}-name`}
              type="text"
              maxLength={60}
              value={name}
              aria-describedby={hint}
              onChange={(event) => {
                setName(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
        <Box id={`${id}-code`} label={form.code} hint={form.codeHint}>
          {(hint) => (
            <input
              className={styles.text}
              id={`${id}-code`}
              type="text"
              maxLength={32}
              value={codeTyped ? code : codeOf(name)}
              aria-describedby={hint}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeTyped(true);
                steps.edit();
              }}
            />
          )}
        </Box>
        <Box id={`${id}-minutes`} label={form.minutes} hint={form.minutesHint(bounds.min, bounds.max)}>
          {(hint) => (
            <input
              className={styles.number}
              id={`${id}-minutes`}
              type="number"
              inputMode="numeric"
              step={1}
              min={bounds.min}
              max={bounds.max}
              value={minutes}
              aria-describedby={hint}
              onChange={(event) => {
                setMinutes(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Box>
      </div>
      {steps.step === "editing" ? (
        <FormButtons ready={ready} onNext={steps.check} onCancel={props.onCancel} />
      ) : (
        <Check
          id={`${id}-check`}
          title={check.title}
          busy={steps.step === "saving"}
          send={check.send}
          back={check.back}
          onSend={steps.go}
          onBack={steps.edit}
        >
          <p className={styles.checkLine}>{check.add(kindName, name.trim(), Number(minutes), codeSent)}</p>
        </Check>
      )}
      <Refused failed={steps.failed} />
    </fieldset>
  );
}
