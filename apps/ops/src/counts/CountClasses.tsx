// Each item's count class (docs/decisions/0185-cycle-counts.md): its kind's own, a hair system weekly and the rest
// quarterly, or the one ops set.

import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";

export type Book = paths["/api/count-tasks"]["get"]["responses"][200]["content"]["application/json"];
type CountClass = Book["classes"][number]["count_class"];

const CLASSES: readonly CountClass[] = ["weekly", "monthly", "quarterly"];
const OWN = "";

export function CountClasses({ book, onBook }: { book: Book; onBook: (book: Book) => void }) {
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const change = async (code: string, chosen: string) => {
    const answer = await client.post("/api/consumables/{code}/count-class", {
      path: { code },
      body: { count_class: chosen === OWN ? null : (chosen as CountClass) },
    });
    if (answer.ok) {
      onBook(answer.body);
      setSaid(copy.classSaid);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <section className={form.panel} aria-labelledby="count-classes">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="count-classes">
          {copy.classesTitle}
        </h2>
      </div>
      <p className={form.note}>{copy.classesNote}</p>
      <Table className={form.table}>
        <thead>
          <tr>
            {copy.classColumns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {book.classes.map((item) => {
            const own = item.hair_system ? "weekly" : "quarterly";
            return (
              <tr key={item.consumable_code}>
                <th scope="row" className={form.rowHead}>
                  {item.name}
                </th>
                <td>
                  <Field label={copy.classLabel(item.name)} className={form.field}>
                    {(control) => (
                      <Select
                        {...control}
                        className={form.choiceBox}
                        value={item.set ? item.count_class : OWN}
                        onChange={(event) => void change(item.consumable_code, event.target.value)}
                      >
                        <option value={OWN}>{copy.ownClass(copy.classes[own] ?? own)}</option>
                        {CLASSES.map((each) => (
                          <option key={each} value={each}>
                            {copy.classes[each] ?? each}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {said !== null && (
        <p className={form.saved} role="status">
          {said}
        </p>
      )}
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </section>
  );
}
