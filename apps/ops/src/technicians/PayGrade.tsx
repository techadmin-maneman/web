// A technician's pay grade, chosen when they are added and on their details by those whose Finance access gives
// grades, through pay's own route (docs/decisions/0307-the-people-rulings.md); nobody else sees it.

import { Field, Select } from "@maneman/ui/Field";
import { ChoiceRow } from "@maneman/ui/RecordRows";
import { Failed } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { states } from "@maneman/ui/words";
import { useState } from "react";
import type { TechnicianPay } from "../api.ts";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { technicianPayApi } from "../technician-pay/index.ts";
import { refusal } from "./refusal.ts";
import styles from "./technicians.module.css";

const copy = technicians.payGrade;

/** Whether the person may read the grades and give one. */
function useMayGrade(): boolean {
  const access = useAccess();
  return access.mayCall("GET /api/technician-pay") && access.mayCall("POST /api/technician-pay/technicians/{id}");
}

const choicesOf = (pay: TechnicianPay): (readonly [string, string])[] => [
  ["", copy.none],
  ...pay.grades.map((grade) => [grade.id, grade.name] as const),
];

/** While the grades are read, the one choice says so. */
const READING: (readonly [string, string])[] = [["", copy.reading]];

/** The grades did not come: said where the field stands, with a way to read them again. */
function Unread({ onRetry }: { onRetry: () => void }) {
  return <Failed message={copy.failed} retry={states.retry} onRetry={onRetry} className={styles.gradesUnread} />;
}

function GradeSelect({ value, onChange }: { value: string; onChange: (grade: string) => void }) {
  const [loaded, retry] = useLoad(technicianPayApi.technicianPay);
  if (loaded.state === "failed") return <Unread onRetry={retry} />;
  return (
    <Field label={copy.optional} className={styles.formField}>
      {(control) => (
        <Select
          {...control}
          className={styles.select}
          disabled={loaded.state !== "loaded"}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {(loaded.state === "loaded" ? choicesOf(loaded.value) : READING).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** A new technician's grade, "" for none; drawn only for those who may give one. */
export function PayGradeField({ value, onChange }: { value: string; onChange: (grade: string) => void }) {
  return useMayGrade() ? <GradeSelect value={value} onChange={onChange} /> : null;
}

function GradeRow({ technicianId }: { technicianId: string }) {
  const [loaded, retry] = useLoad(technicianPayApi.technicianPay);
  const [saved, setSaved] = useState<TechnicianPay | null>(null);
  const pay = saved ?? (loaded.state === "loaded" ? loaded.value : null);
  if (pay === null && loaded.state === "failed") return <Unread onRetry={retry} />;
  if (pay === null) {
    return (
      <ChoiceRow label={copy.label} value="" choices={READING} mayChange={false} save={() => Promise.resolve(null)} />
    );
  }
  // A technician switched off is not on pay's list, and has no grade to change.
  const technician = pay.technicians.find((each) => each.id === technicianId);
  if (technician === undefined) return null;
  return (
    <ChoiceRow
      label={copy.label}
      value={technician.grade_id ?? ""}
      choices={choicesOf(pay)}
      mayChange
      save={async (grade) => {
        const answer = await technicianPayApi.setPayGradeOf(technicianId, grade === "" ? null : grade);
        if (!answer.ok) return refusal(answer.code);
        setSaved(answer.body);
        return null;
      }}
    />
  );
}

/** Their grade on their details, changed where it reads; drawn only for those who may give one. */
export function PayGradeRow({ technicianId }: { technicianId: string }) {
  return useMayGrade() ? <GradeRow technicianId={technicianId} /> : null;
}
