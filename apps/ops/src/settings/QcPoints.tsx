// The checks on a hair system that arrives, beneath Settings › Purchasing (docs/decisions/0169-supplier-claims.md): each
// a row that opens its record, where it is renamed and switched on or off, and deleted while no claim names it
// (docs/decisions/0283-changed-and-deleted-while-unused.md). A claim keeps the names as they read when drafted.

import { AddForm } from "@maneman/ui/AddForm";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Field, TextInput } from "@maneman/ui/Field";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Panel } from "@maneman/ui/Panel";
import { ChoiceRow, TextRow } from "@maneman/ui/RecordRows";
import { RowHead } from "@maneman/ui/RowHead";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { RowOpener, Table } from "@maneman/ui/Table";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText } from "@maneman/web-kit/refusal";
import form from "@maneman/ui/forms.module.css";
import { useState } from "react";
import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";
import { purchasing } from "../content/purchasing.ts";
import { useAccess } from "../lib/access.ts";
import { qcPointsApi } from "./qc-points-api.ts";

const copy = purchasing.points;

type QcPoint = Success<paths["/api/qc-points"]["get"]>["points"][number];

function AddPoint({ onAdded }: { readonly onAdded: () => void }) {
  const [name, setName] = useState("");
  return (
    <DrawerButton label={copy.add}>
      {(close) => (
        <AddForm
          title={copy.add}
          words={{ add: copy.addButton }}
          errors={copy.errors}
          boxes={["name"]}
          send={() => qcPointsApi.add(name.trim())}
          onAdded={() => {
            close();
            onAdded();
          }}
          onCancel={close}
        >
          <div className={form.fields}>
            <Field label={copy.name} className={form.field} box="name">
              {(control) => (
                <TextInput
                  {...control}
                  maxLength={40}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
        </AddForm>
      )}
    </DrawerButton>
  );
}

/** A check's record: its name and whether it is made, each changed where it reads; Delete while no claim names it. */
function PointRecord(props: { readonly point: QcPoint; readonly mayChange: boolean; readonly onDeleted: () => void }) {
  const { point, mayChange } = props;
  const save = async (change: Partial<{ name: string; checked: boolean }>) => {
    const answer = await qcPointsApi.change(point.id, { name: point.name, checked: point.checked, ...change });
    return answer.ok ? null : errorText(copy.errors, answer);
  };
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={copy.name}
          value={point.name}
          maxLength={40}
          mayChange={mayChange}
          save={(typed) => save({ name: typed.trim() })}
        />
        <ChoiceRow
          label={copy.checked}
          value={point.checked ? "yes" : "no"}
          choices={[
            ["yes", copy.yes],
            ["no", copy.no],
          ]}
          mayChange={mayChange}
          save={(said) => save({ checked: said === "yes" })}
        />
      </div>
      {mayChange && (
        <div className={form.recordFoot}>
          {point.deletable ? (
            <DeleteAction
              name={point.name}
              send={() => qcPointsApi.delete(point.id)}
              refusal={(code) => errorText(copy.errors, { code })}
              onDeleted={props.onDeleted}
            />
          ) : (
            <p className={form.note}>{copy.inUse}</p>
          )}
        </div>
      )}
    </>
  );
}

/** Each check, in order, with whether it is made; a row opens its record. */
export function QcPoints() {
  const [loaded, retry] = useLoad(qcPointsApi.points);
  const access = useAccess();
  const [opened, setOpened] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const points = loaded.value.points;
  const open = points.find((point) => point.id === opened);
  return (
    <Panel
      titleId="qc-points"
      title={copy.panel}
      count={points.length}
      actions={
        access.mayCall("POST /api/qc-points") && (
          <AddPoint
            onAdded={() => {
              setSaid(copy.added);
            }}
          />
        )
      }
    >
      <Table>
        <thead>
          <tr>
            <th scope="col">{copy.columns.name}</th>
            <th scope="col">{copy.columns.checked}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.id}>
              <RowHead>
                <RowOpener
                  onOpen={() => {
                    setSaid(null);
                    setOpened(point.id);
                  }}
                >
                  {point.name}
                </RowOpener>
              </RowHead>
              <td>{point.checked ? copy.yes : copy.no}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {said !== null && <Toast>{said}</Toast>}
      {open !== undefined && (
        <FormDrawer
          title={open.name}
          onClose={() => {
            setOpened(null);
          }}
        >
          <PointRecord
            point={open}
            mayChange={access.mayCall("PATCH /api/qc-points/{id}")}
            onDeleted={() => {
              setOpened(null);
              setSaid(copy.deleted);
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}
