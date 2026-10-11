// The seniority grades technicians are paid by (docs/decisions/0122-technician-pay-per-visit.md): added, renamed, and
// deleted while nothing uses one.

import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type TechnicianPay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { usePaySend } from "./pay-send.ts";
import styles from "../components/forms.module.css";

const copy = technicianPay.grades;

type Grade = TechnicianPay["grades"][number];

function AddGrade({ onChanged }: { onChanged: (pay: TechnicianPay) => void }) {
  const [name, setName] = useState("");
  const { sending, failure, send } = usePaySend(onChanged);
  return (
    <form
      className={styles.group}
      onSubmit={(event) => {
        event.preventDefault();
        void send(() => api.addPayGrade(name.trim())).then((added) => {
          if (added) setName("");
        });
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pay-grade-new">
            {copy.name}
          </label>
          <input
            className={styles.text}
            id="pay-grade-new"
            type="text"
            maxLength={40}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="small" disabled={name.trim() === "" || sending}>
          {sending ? copy.adding : copy.add}
        </Button>
      </div>
      {failure !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </form>
  );
}

interface RowProps {
  readonly grade: Grade;
  readonly mayChange: boolean;
  readonly onChanged: (pay: TechnicianPay) => void;
}

function RenameGrade({ grade, onChanged, onDone }: Omit<RowProps, "mayChange"> & { readonly onDone: () => void }) {
  const [name, setName] = useState(grade.name);
  const { sending, failure, send } = usePaySend(onChanged);
  const id = `pay-grade-${grade.id}`;
  return (
    <li className={styles.rule}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {copy.newName(grade.name)}
      </label>
      <input
        className={styles.text}
        id={id}
        type="text"
        maxLength={40}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={name.trim() === "" || sending}
          onClick={() => {
            void send(() => api.renamePayGrade(grade.id, name.trim())).then((renamed) => {
              if (renamed) onDone();
            });
          }}
        >
          {copy.save}
        </Button>
        <Button variant="outline" size="small" onClick={onDone}>
          {copy.cancel}
        </Button>
      </div>
      {failure !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </li>
  );
}

function GradeRow({ grade, mayChange, onChanged }: RowProps) {
  const [renaming, setRenaming] = useState(false);
  const { sending, failure, send } = usePaySend(onChanged);

  if (renaming) {
    return (
      <RenameGrade
        grade={grade}
        onChanged={onChanged}
        onDone={() => {
          setRenaming(false);
        }}
      />
    );
  }
  return (
    <li className={styles.rule}>
      <p className={styles.period}>
        {grade.name} · {copy.holders(grade.technicians)}
      </p>
      {mayChange && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            aria-label={copy.renameLabel(grade.name)}
            onClick={() => {
              setRenaming(true);
            }}
          >
            {copy.rename}
          </Button>
          <Button
            variant="outline"
            size="small"
            disabled={sending}
            aria-label={copy.deleteLabel(grade.name)}
            onClick={() => void send(() => api.deletePayGrade(grade.id))}
          >
            {copy.delete}
          </Button>
        </div>
      )}
      {failure !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </li>
  );
}

export function PayGrades(props: { pay: TechnicianPay; mayChange: boolean; onChanged: (pay: TechnicianPay) => void }) {
  return (
    <Panel titleId="pay-grades" title={copy.title} className={styles.panel}>
      {props.mayChange && <AddGrade onChanged={props.onChanged} />}
      {props.pay.grades.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <ul className={styles.rules}>
          {props.pay.grades.map((grade) => (
            <GradeRow key={grade.id} grade={grade} mayChange={props.mayChange} onChanged={props.onChanged} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
