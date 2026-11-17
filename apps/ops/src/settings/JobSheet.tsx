// Settings, Job sheet (docs/decisions/0087-consumables-and-stock.md): the technician's checklists, why a job is left
// partly done, why a client does not go ahead (ADR 0149) and why a hair system was not fitted (ADR 0269). A
// phone keeps the list it got with the job and an item taken off is kept, so older records still read. Until ops save a
// list, src/config/job-sheet.ts's stands.

import { Field, Select } from "@maneman/ui/Field";
import { Stack } from "@maneman/ui/Layout";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { type JobSheet as Sheet, type VisitType } from "../api.ts";
import { dispatch } from "../content.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ListEditor, ListRead } from "./ListEditor.tsx";
import { settingsApi } from "./settings-api.ts";

const copy = settings.jobSheet;

const typeName = (type: keyof typeof dispatch.typeNames) => dispatch.typeNames[type];

type EditorProps = Parameters<typeof ListEditor>[0];

/** One of the sheet's lists of reasons: to read, or to change where the caller may. */
function Reasons(
  props: Pick<EditorProps, "id" | "title" | "list" | "most" | "longest" | "send" | "onSaved"> & {
    mayChange: boolean;
  },
) {
  const { mayChange, ...list } = props;
  if (!mayChange) return <ListRead title={list.title} list={list.list} />;
  return <ListEditor {...list} itemLabel={copy.reason} addLabel={copy.addReason} />;
}

/** The sheet's three lists of reasons: partly done, not going ahead, and not fitted. */
function ReasonLists({ current, onSaved }: { current: Sheet; onSaved: (sheet: Sheet) => void }) {
  const access = useAccess();
  const mayChangeReasons = access.mayCall("POST /api/job-sheet/partial-reasons");
  const mayChangeLost = access.mayCall("POST /api/job-sheet/lost-reasons");
  const mayChangeNotFitted = access.mayCall("POST /api/job-sheet/not-fitted-reasons");
  return (
    <>
      <Reasons
        id="partial-reasons"
        title={copy.reasons}
        list={current.partial_reasons}
        most={current.max_partial_reasons}
        mayChange={mayChangeReasons}
        send={(items) => settingsApi.setPartialReasons(items)}
        onSaved={onSaved}
        longest={current.max_label}
      />
      <Reasons
        id="lost-reasons"
        title={copy.lostReasons}
        list={current.lost_reasons}
        most={current.max_lost_reasons}
        mayChange={mayChangeLost}
        send={(items) => settingsApi.setLostReasons(items)}
        onSaved={onSaved}
        longest={current.max_label}
      />
      <Reasons
        id="not-fitted-reasons"
        title={copy.notFittedReasons}
        list={current.not_fitted_reasons}
        most={current.max_not_fitted_reasons}
        mayChange={mayChangeNotFitted}
        send={(items) => settingsApi.setNotFittedReasons(items)}
        onSaved={onSaved}
        longest={current.max_label}
      />
    </>
  );
}

export function JobSheet() {
  const [loaded, retry] = useLoad(settingsApi.jobSheet);
  /** The sheet after a save, so "Set by" follows without reading it again. */
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [kind, setKind] = useState<VisitType>("service");
  const access = useAccess();
  const mayChangeChecklists = access.mayCall("POST /api/job-sheet/checklists/{visit_type}");

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = sheet ?? loaded.value;
  const checklist = current.checklists.find((each) => each.visit_type === kind);

  return (
    <Stack>
      <Toolbar label={copy.title}>
        <Field label={copy.kind} labelHidden>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={kind}
              onChange={(event) => {
                const chosen = current.checklists.find((each) => each.visit_type === event.target.value);
                if (chosen !== undefined) setKind(chosen.visit_type);
              }}
            >
              {current.checklists.map((each) => (
                <option key={each.visit_type} value={each.visit_type}>
                  {typeName(each.visit_type)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Toolbar>
      {checklist !== undefined && !mayChangeChecklists && (
        <ListRead title={copy.checklist(typeName(kind))} list={checklist} />
      )}
      {checklist !== undefined && mayChangeChecklists && (
        <ListEditor
          key={kind}
          id={`checklist-${kind}`}
          title={copy.checklist(typeName(kind))}
          list={checklist}
          most={current.max_checklist_items}
          longest={current.max_label}
          itemLabel={copy.item}
          clientLabel={copy.clientWords}
          addLabel={copy.add}
          send={(items) => settingsApi.setChecklist(kind, items)}
          onSaved={setSheet}
        />
      )}
      <ReasonLists current={current} onSaved={setSheet} />
    </Stack>
  );
}
