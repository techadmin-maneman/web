// What technicians are paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md):
// Finance names the grades, sets a rate per grade and kind of visit, for every city or one, from a date, and gives
// each technician a grade. No board draws it, so its panels are laid out as Settings' are; a row opens its record
// beside the table (docs/decisions/0212-editing-in-place.md).

import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { classes } from "@maneman/ui/classes";
import { errorText } from "@maneman/web-kit/refusal";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { type TechnicianPay as Pay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ChoiceRow } from "../components/RecordRows.tsx";
import { PayRates } from "./PayRates.tsx";
import { PayStatement } from "./PayStatement.tsx";
import form from "../components/forms.module.css";
import styles from "./technician-pay.module.css";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { technicianPayApi } from "./technician-pay-api.ts";

const copy = technicianPay.technicians;

type PayTechnician = Pay["technicians"][number];

/** A technician's grade, changed where it reads; with no grade, their visits are not paid. */
function GradeOf({
  pay,
  technician,
  onChanged,
}: {
  pay: Pay;
  technician: PayTechnician;
  onChanged: (pay: Pay) => void;
}) {
  return (
    <div className={form.record}>
      <ChoiceRow
        label={copy.grade}
        value={technician.grade_id ?? ""}
        choices={[["", copy.noGrade], ...pay.grades.map((grade) => [grade.id, grade.name] as const)]}
        mayChange={useAccess().mayCall("POST /api/technician-pay/technicians/{id}")}
        save={async (chosen) => {
          const answer = await technicianPayApi.setPayGradeOf(technician.id, chosen === "" ? null : chosen);
          if (!answer.ok) return errorText(technicianPay.errors, answer);
          onChanged(answer.body);
          return null;
        }}
      />
    </div>
  );
}

function PayTechnicians({ pay, onChanged }: { pay: Pay; onChanged: (pay: Pay) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = pay.technicians.find((technician) => technician.id === open);
  const gradeOf = (technician: PayTechnician) =>
    pay.grades.find((each) => each.id === technician.grade_id)?.name ?? copy.noGrade;
  return (
    <Panel titleId="pay-technicians" title={copy.title}>
      {pay.technicians.length === 0 ? (
        <Note>{copy.none}</Note>
      ) : (
        <TableScroll labelledBy="pay-technicians">
          <Table className={classes(styles.table, styles.people)}>
            <thead>
              <tr>
                <th scope="col">{copy.name}</th>
                <th scope="col">{copy.city}</th>
                <th scope="col">{copy.grade}</th>
              </tr>
            </thead>
            <tbody>
              {pay.technicians.map((technician) => (
                <tr key={technician.id}>
                  <th scope="row">
                    <TextButton
                      compact
                      aria-label={copy.open(technician.name)}
                      onClick={() => {
                        setOpen(technician.id);
                      }}
                    >
                      {technician.name}
                    </TextButton>
                  </th>
                  <td>{technician.city ?? copy.noCity}</td>
                  <td>{gradeOf(technician)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {opened !== undefined && (
        <FormDrawer
          title={opened.name}
          onClose={() => {
            setOpen(null);
          }}
        >
          <GradeOf pay={pay} technician={opened} onChanged={onChanged} />
        </FormDrawer>
      )}
    </Panel>
  );
}

/**
 * Technician pay, in its two places: the grades, their rates and each technician's grade, which Settings holds; and
 * the month's statements, which Money holds.
 */
export function TechnicianPay({ part }: { readonly part: "grades" | "statements" }) {
  const [loaded, retry] = useLoad(technicianPayApi.technicianPay);
  /** The pay as the last change left it, so the page follows a change without reading it again. */
  const [changed, setChanged] = useState<Pay | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const pay = changed ?? loaded.value;
  if (part === "statements") return <PayStatement today={pay.today} />;
  return (
    <>
      <PayRates pay={pay} mayAdd={access.mayCall("POST /api/technician-pay/grades")} onChanged={setChanged} />
      <PayTechnicians pay={pay} onChanged={setChanged} />
    </>
  );
}
