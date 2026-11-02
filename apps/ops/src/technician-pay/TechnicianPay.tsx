// What technicians are paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md):
// Finance names the grades, sets a rate per grade and kind of visit, for every city or one, from a date, and gives
// each technician a grade. No board draws it, so its panels are laid out as Settings' are; a row opens its record
// beside the table (docs/decisions/0212-editing-in-place.md).

import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { NoValue } from "@maneman/ui/NoValue";
import { Badge } from "@maneman/ui/Badge";
import { Table, TableScroll } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { TextButton } from "@maneman/ui/TextLink";
import { classes } from "@maneman/ui/classes";
import { errorText } from "@maneman/web-kit/refusal";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { type TechnicianPay as Pay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ChoiceRow } from "@maneman/ui/RecordRows";
import { PayRates } from "./PayRates.tsx";
import { PayStatement } from "./PayStatement.tsx";
import form from "@maneman/ui/forms.module.css";
import styles from "./technician-pay.module.css";
import { FormDrawer } from "@maneman/ui/FormDrawer";
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

/** A technician's grade by its name, or none. */
const gradeName = (pay: Pay, technician: PayTechnician) =>
  pay.grades.find((each) => each.id === technician.grade_id)?.name ?? null;

/** Each technician a row, sorting by name, city or grade, narrowed by city and by grade. */
function PayTable({ pay, onOpen }: { pay: Pay; onOpen: (id: string) => void }) {
  const columns: readonly Column<PayTechnician>[] = [
    { label: copy.name, sort: (row) => row.name },
    { label: copy.city, sort: (row) => row.city ?? "", choice: (row) => row.city ?? copy.noCity },
    {
      label: copy.grade,
      sort: (row) => gradeName(pay, row) ?? "",
      choice: (row) => gradeName(pay, row) ?? copy.noGrade,
    },
  ];
  const view = useTableView(pay.technicians, columns, { search: (row) => row.name });
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <TableScroll labelledBy="pay-technicians">
        <Table className={classes(styles.table, styles.people)}>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((technician) => (
              <tr key={technician.id}>
                <th scope="row">
                  <TextButton
                    compact
                    aria-label={copy.open(technician.name)}
                    onClick={() => {
                      onOpen(technician.id);
                    }}
                  >
                    {technician.name}
                  </TextButton>
                </th>
                <td>{technician.city ?? <NoValue />}</td>
                {/* With no grade, a warning: nothing they do is paid until they have one. */}
                <td>{gradeName(pay, technician) ?? <Badge tone="warning">{copy.noGrade}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

function PayTechnicians({ pay, onChanged }: { pay: Pay; onChanged: (pay: Pay) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = pay.technicians.find((technician) => technician.id === open);
  return (
    <Panel titleId="pay-technicians" title={copy.title}>
      {pay.technicians.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <PayTable pay={pay} onOpen={setOpen} />
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

  if (loaded.state === "loading") return <PanelLoading />;
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
