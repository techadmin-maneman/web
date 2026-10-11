// What technicians are paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md):
// Finance names the grades, gives each technician one, and sets a rate per grade and kind of visit, for every city or
// one, from a date. No board draws it, so its panels are laid out as Settings' are.

import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type TechnicianPay as Pay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { PayGrades } from "./PayGrades.tsx";
import { PayRates } from "./PayRates.tsx";
import { usePaySend } from "./pay-send.ts";
import styles from "../components/forms.module.css";

const copy = technicianPay.technicians;

type PayTechnician = Pay["technicians"][number];

function TechnicianRow(props: { technician: PayTechnician; pay: Pay; maySet: boolean; onChanged: (pay: Pay) => void }) {
  const { technician, pay } = props;
  const { sending, failure, send } = usePaySend(props.onChanged);
  return (
    <tr>
      <th scope="row">{technician.name}</th>
      <td>{technician.city ?? copy.noCity}</td>
      <td>
        <select
          className={styles.select}
          aria-label={copy.gradeOf(technician.name)}
          value={technician.grade_id ?? ""}
          disabled={!props.maySet || sending}
          onChange={(event) => {
            const grade = event.target.value === "" ? null : event.target.value;
            void send(() => api.setPayGradeOf(technician.id, grade));
          }}
        >
          <option value="">{copy.noGrade}</option>
          {pay.grades.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {grade.name}
            </option>
          ))}
        </select>
        {failure !== null && (
          <p className={styles.error} role="alert">
            {errorText(copy.errors, failure)}
          </p>
        )}
      </td>
    </tr>
  );
}

function PayTechnicians(props: { pay: Pay; maySet: boolean; onChanged: (pay: Pay) => void }) {
  return (
    <Panel titleId="pay-technicians" title={copy.title} className={styles.panel}>
      {props.pay.technicians.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{copy.name}</th>
              <th scope="col">{copy.city}</th>
              <th scope="col">{copy.grade}</th>
            </tr>
          </thead>
          <tbody>
            {props.pay.technicians.map((technician) => (
              <TechnicianRow key={technician.id} technician={technician} {...props} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function TechnicianPay() {
  const [loaded, retry] = useLoad(api.technicianPay);
  /** The pay as the last change left it, so the page follows a change without reading it again. */
  const [changed, setChanged] = useState<Pay | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const pay = changed ?? loaded.value;
  return (
    <>
      <PayGrades pay={pay} mayChange={access.mayCall("POST /api/technician-pay/grades")} onChanged={setChanged} />
      {pay.grades.length > 0 && (
        <PayRates pay={pay} maySet={access.mayCall("POST /api/technician-pay/rates")} onChanged={setChanged} />
      )}
      <PayTechnicians
        pay={pay}
        maySet={access.mayCall("POST /api/technician-pay/technicians/{id}")}
        onChanged={setChanged}
      />
    </>
  );
}
