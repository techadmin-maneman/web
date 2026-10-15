// What technicians are paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md):
// Finance names the grades, sets a rate per grade and kind of visit, for every city or one, from a date, and gives
// each technician a grade. No board draws it, so its panels are laid out as Settings' are.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { type TechnicianPay as Pay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { GradeOfForm } from "./PayForms.tsx";
import { PayRates } from "./PayRates.tsx";
import { PayStatement } from "./PayStatement.tsx";
import form from "../components/forms.module.css";
import styles from "./technician-pay.module.css";
import { ActionRow } from "../components/ActionRow.tsx";
import { technicianPayApi } from "./technician-pay-api.ts";

const copy = technicianPay.technicians;

type PayTechnician = Pay["technicians"][number];

interface RowProps {
  readonly pay: Pay;
  readonly maySet: boolean;
  /** The technician whose grade is open beneath their row. */
  readonly acting: string | null;
  readonly onAct: (acting: string | null) => void;
  readonly onDone: (pay: Pay) => void;
}

function TechnicianRows({ technician, pay, maySet, acting, onAct, onDone }: { technician: PayTechnician } & RowProps) {
  const grade = pay.grades.find((each) => each.id === technician.grade_id)?.name ?? copy.noGrade;
  return (
    <>
      <tr>
        <th scope="row">{technician.name}</th>
        <td>{technician.city ?? copy.noCity}</td>
        <td>{grade}</td>
        <td className={styles.actions}>
          {maySet && pay.grades.length > 0 && (
            <RowButton
              beside
              aria-label={copy.changeLabel(technician.name)}
              disabled={acting !== null}
              onClick={() => {
                onAct(technician.id);
              }}
            >
              {copy.change}
            </RowButton>
          )}
        </td>
      </tr>
      {acting === technician.id && (
        <ActionRow className={styles.acting}>
          <GradeOfForm
            technician={technician}
            pay={pay}
            onDone={onDone}
            onCancel={() => {
              onAct(null);
            }}
          />
        </ActionRow>
      )}
    </>
  );
}

function PayTechnicians({ pay, maySet, onChanged }: { pay: Pay; maySet: boolean; onChanged: (pay: Pay) => void }) {
  const [acting, setActing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const row: RowProps = {
    pay,
    maySet,
    acting,
    onAct: (next) => {
      setSaved(false);
      setActing(next);
    },
    onDone: (next) => {
      setActing(null);
      setSaved(true);
      onChanged(next);
    },
  };
  return (
    <Panel titleId="pay-technicians" title={copy.title} padded>
      {saved && (
        <InlineMessage tone="saved" className={form.saved}>
          {technicianPay.done.saved}
        </InlineMessage>
      )}
      {pay.technicians.length === 0 ? (
        <Note>{copy.none}</Note>
      ) : (
        <TableScroll labelledBy="pay-technicians">
          <Table controls className={classes(styles.table, styles.people)}>
            <thead>
              <tr>
                <th scope="col">{copy.name}</th>
                <th scope="col">{copy.city}</th>
                <th scope="col">{copy.grade}</th>
                <th scope="col">
                  <VisuallyHidden>{technicianPay.rates.actions}</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {pay.technicians.map((technician) => (
                <TechnicianRows key={technician.id} technician={technician} {...row} />
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

export function TechnicianPay() {
  const [loaded, retry] = useLoad(technicianPayApi.technicianPay);
  /** The pay as the last change left it, so the page follows a change without reading it again. */
  const [changed, setChanged] = useState<Pay | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const pay = changed ?? loaded.value;
  const may = {
    grades: access.mayCall("POST /api/technician-pay/grades"),
    rates: access.mayCall("POST /api/technician-pay/rates"),
  };
  return (
    <>
      <PayRates pay={pay} may={may} onChanged={setChanged} />
      <PayTechnicians
        pay={pay}
        maySet={access.mayCall("POST /api/technician-pay/technicians/{id}")}
        onChanged={setChanged}
      />
      <PayStatement today={pay.today} />
    </>
  );
}
