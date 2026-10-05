// What each service is expected to use: where the technician's steppers start
// on a job of it (docs/decisions/0087-consumables-and-stock.md). A service is
// one the console holds, by its name, a kind at a time
// (docs/decisions/0085-services-ops-can-edit.md); a retired one is here too,
// marked, since a visit sold before it was retired is still done. The whole
// list is sent at once, and the check shows each consumable whose figure
// changes, old beside new (ADR 0071). An empty box is none.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Consumables, type ServiceUse } from "../api.ts";
import { dispatch, settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import styles from "../components/forms.module.css";
import own from "./consumables.module.css";

const copy = settings.consumables;
const words = copy.usage;

const keyOf = (service: ServiceUse) => `${service.visit_type}/${service.tier}`;
const serviceName = (service: ServiceUse) =>
  words.serviceName(service.name, service.retired_date === null ? null : longDate(service.retired_date));

/** Each consumable's box, as text: the figure the service expects, or empty for none. */
type Draft = Readonly<Record<string, string>>;

const draftOf = (service: ServiceUse | undefined): Draft =>
  Object.fromEntries((service?.expected ?? []).map((each) => [each.code, String(each.quantity)]));

type Step = { readonly step: "editing" | "checking" | "saving" | "saved" } | ({ readonly step: "failed" } & Failure);

export function ServiceUsage({ book, onSaved }: { book: Consumables; onSaved: (book: Consumables) => void }) {
  const [chosen, setChosen] = useState(() => {
    const first = book.services[0];
    return first === undefined ? "" : keyOf(first);
  });
  const service = book.services.find((each) => keyOf(each) === chosen);
  const [draft, setDraft] = useState<Draft>(() => draftOf(service));
  const [step, setStep] = useState<Step>({ step: "editing" });
  const mayChange = useAccess().mayCall("POST /api/service-usage");

  // Every consumable offered, and any retired one this service still expects, so a save never drops it unseen.
  const expectedCodes = new Set(service?.expected.map((each) => each.code) ?? []);
  const listed = book.consumables.filter((each) => each.offered || expectedCodes.has(each.code));
  const was = new Map(service?.expected.map((each) => [each.code, each.quantity]) ?? []);
  const figure = (code: string) => (draft[code] ?? "").trim();
  const valid = listed.every((each) => figure(each.code) === "" || /^\d{1,3}$/.test(figure(each.code)));
  const items = listed.flatMap((each) => {
    const quantity = Number(figure(each.code));
    return figure(each.code) === "" || quantity === 0 ? [] : [{ code: each.code, quantity }];
  });
  const lines = listed.flatMap((each) => {
    const before = was.get(each.code) ?? null;
    const after = items.find((item) => item.code === each.code)?.quantity ?? null;
    if (before === after) return [];
    const said = (quantity: number | null) =>
      quantity === null ? words.confirm.none : `${String(quantity)} ${each.unit}`;
    return [words.confirm.line(each.name, said(before), said(after))];
  });

  const send = async () => {
    if (service === undefined) return;
    setStep({ step: "saving" });
    const answer = await api.setServiceUsage({ visit_type: service.visit_type, tier: service.tier, items });
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onSaved(answer.body);
    setStep({ step: "saved" });
  };

  const checking = step.step === "checking" || step.step === "saving";
  return (
    <Panel titleId="service-usage" title={words.title} className={styles.panel}>
      <p className={styles.note}>{words.note}</p>
      <fieldset className={styles.group}>
        <legend className={styles.ruleTitle}>{service === undefined ? words.title : serviceName(service)}</legend>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="usage-service">
            {words.service}
          </label>
          <select
            className={styles.select}
            id="usage-service"
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
              setDraft(draftOf(book.services.find((each) => keyOf(each) === event.target.value)));
              setStep({ step: "editing" });
            }}
          >
            {[...new Set(book.services.map((each) => each.visit_type))].map((kind) => (
              <optgroup key={kind} label={dispatch.typeNames[kind] ?? kind}>
                {book.services
                  .filter((each) => each.visit_type === kind)
                  .map((each) => (
                    <option key={keyOf(each)} value={keyOf(each)}>
                      {serviceName(each)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        {listed.length === 0 ? (
          <p className={styles.note}>{words.noneOffered}</p>
        ) : (
          <ul className={own.uses}>
            {listed.map((each) => (
              <li className={own.use} key={each.code}>
                <label className={own.useLabel} htmlFor={`usage-${each.code}`}>
                  {words.quantity(each.name, each.unit)}
                </label>
                <input
                  className={styles.number}
                  id={`usage-${each.code}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  readOnly={!mayChange}
                  value={draft[each.code] ?? ""}
                  aria-describedby="usage-hint"
                  onChange={(event) => {
                    setDraft({ ...draft, [each.code]: event.target.value });
                    setStep({ step: "editing" });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className={styles.hint} id="usage-hint">
          {words.quantityHint(book.max_expected)}
        </p>
        {checking && (
          <CheckPanel
            title={words.confirm.title}
            lines={lines.length === 0 ? [words.confirm.nothing] : lines}
            send={words.confirm.send}
            sending={copy.form.saving}
            back={words.confirm.back}
            busy={step.step === "saving"}
            ready={lines.length > 0}
            onSend={() => void send()}
            onBack={() => {
              setStep({ step: "editing" });
            }}
          />
        )}
        {!checking && mayChange && (
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="small"
              disabled={service === undefined || listed.length === 0 || !valid}
              onClick={() => {
                setStep({ step: "checking" });
              }}
            >
              {words.save}
            </Button>
          </div>
        )}
        {step.step === "saved" && (
          <p className={styles.saved} role="status">
            {words.saved}
          </p>
        )}
        {step.step === "failed" && (
          <p className={styles.error} role="alert">
            {errorText(copy.errors, step)}
          </p>
        )}
      </fieldset>
    </Panel>
  );
}
