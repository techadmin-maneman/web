// What each grade is paid for each kind of visit, for every city or one (docs/decisions/0122-technician-pay-per-visit.md).
// A city with no rate of its own shows every city's, marked; a rate set to start later shows beneath the one in force.
// A grade's row opens its record beside the table, where its name and its rates change where they read.

import { Toast } from "@maneman/ui/Toast";
import { PageActions } from "../components/PageHead.tsx";
import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { classes } from "@maneman/ui/classes";
import { Note } from "@maneman/ui/Note";
import { useState } from "react";
import { type TechnicianPay } from "../api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { technicianPay } from "../content/technician-pay.ts";
import { tables } from "../content.ts";
import { AddGrade, GradeRecord } from "./PayForms.tsx";
import { rateNow, ratesLater } from "./pay-rates.ts";
import shared from "./technician-pay.module.css";
import styles from "./pay-rates.module.css";

const copy = technicianPay.rates;

type Grade = TechnicianPay["grades"][number];

function GradeRow(props: { pay: TechnicianPay; city: string | null; grade: Grade; onOpen: () => void }) {
  const { pay, grade, city } = props;
  return (
    <tr>
      <th scope="row" className={shared.grade}>
        <TextButton compact aria-label={copy.open(grade.name)} onClick={props.onOpen}>
          {grade.name}
        </TextButton>
      </th>
      <td className={shared.figure}>{grade.technicians}</td>
      {pay.kinds.map((kind) => (
        <td key={kind} className={shared.figure}>
          {rateNow(pay, { grade: grade.id, kind, city })}
          {ratesLater(pay, { grade: grade.id, kind, city }).map((line) => (
            <span key={line} className={styles.later}>
              {line}
            </span>
          ))}
        </td>
      ))}
    </tr>
  );
}

function RatesTable(props: { pay: TechnicianPay; city: string | null; onOpen: (id: string) => void }) {
  const { pay } = props;
  return (
    <TableScroll labelledBy="pay-rates">
      <Table className={classes(shared.table, styles.rates)}>
        <thead>
          <tr>
            <th scope="col">{copy.grade}</th>
            <th scope="col" className={shared.figure}>
              {copy.technicians}
            </th>
            {pay.kinds.map((kind) => (
              <th key={kind} scope="col" className={shared.figure}>
                {technicianPay.kinds[kind]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pay.grades.map((grade) => (
            <GradeRow
              key={grade.id}
              pay={pay}
              city={props.city}
              grade={grade}
              onOpen={() => {
                props.onOpen(grade.id);
              }}
            />
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** The city the rates are shown for: every city's, or one city's with every city's standing in. */
function CityChoice({ pay, city, onCity }: { pay: TechnicianPay; city: string; onCity: (city: string) => void }) {
  return (
    <div className={shared.tools}>
      <Field label={copy.city}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={city}
            onChange={(event) => {
              onCity(event.target.value);
            }}
          >
            <option value="">{tables.allCities}</option>
            {pay.cities.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function PayRates(props: { pay: TechnicianPay; mayAdd: boolean; onChanged: (pay: TechnicianPay) => void }) {
  const { pay } = props;
  const [city, setCity] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const opened = pay.grades.find((grade) => grade.id === open);
  const shown = city === "" ? null : city;
  return (
    <>
      <PageActions>
        {props.mayAdd && (
          <DrawerButton primary label={copy.addGrade}>
            {(close) => (
              <AddGrade
                onAdded={(next) => {
                  props.onChanged(next);
                  setSaid(technicianPay.done.saved);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )}
      </PageActions>
      <Panel titleId="pay-rates" title={copy.title} padded>
        {said !== null && <Toast>{said}</Toast>}
        {pay.grades.length === 0 ? (
          <Note>{copy.none}</Note>
        ) : (
          <>
            <CityChoice pay={pay} city={city} onCity={setCity} />
            <RatesTable
              pay={pay}
              city={shown}
              onOpen={(id) => {
                setSaid(null);
                setOpen(id);
              }}
            />
          </>
        )}
        {opened !== undefined && (
          <FormDrawer
            title={opened.name}
            onClose={() => {
              setOpen(null);
            }}
          >
            <GradeRecord
              pay={pay}
              grade={opened}
              city={shown}
              onSaved={props.onChanged}
              onDeleted={(next) => {
                props.onChanged(next);
                setOpen(null);
                setSaid(technicianPay.done.deleted);
              }}
            />
          </FormDrawer>
        )}
      </Panel>
    </>
  );
}
