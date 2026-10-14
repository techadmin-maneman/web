// Settings, Job sheet (docs/decisions/0087-consumables-and-stock.md): what the technician ticks on each kind of visit,
// the reasons a job is left partly done, and why a client does not go ahead (docs/decisions/0149-lost-reasons.md). A
// phone keeps the list it got with the job and an item taken off is kept, so older records still read. Until ops save a
// list, src/config/job-sheet.ts's stands.

import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type JobSheet as Sheet, type VisitType } from "../api.ts";
import { dispatch } from "../content.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ListEditor, ListRead } from "./ListEditor.tsx";
import styles from "../components/forms.module.css";

const copy = settings.jobSheet;

const typeName = (type: keyof typeof dispatch.typeNames) => dispatch.typeNames[type];

type EditorProps = Parameters<typeof ListEditor>[0];

/** One of the sheet's lists of reasons: to read, or to change where the caller may. */
function Reasons(
  props: Pick<EditorProps, "id" | "title" | "list" | "most" | "longest" | "send" | "pick" | "onSaved"> & {
    mayChange: boolean;
  },
) {
  const { mayChange, ...list } = props;
  if (!mayChange) return <ListRead title={list.title} list={list.list} />;
  return <ListEditor {...list} itemLabel={copy.reason} addLabel={copy.addReason} />;
}

export function JobSheet() {
  const [loaded, retry] = useLoad(api.jobSheet);
  /** The sheet after a save, so "Set by" follows without reading it again. */
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [kind, setKind] = useState<VisitType>("service");
  const access = useAccess();
  const mayChangeChecklists = access.mayCall("POST /api/job-sheet/checklists/{visit_type}");
  const mayChangeReasons = access.mayCall("POST /api/job-sheet/partial-reasons");
  const mayChangeLost = access.mayCall("POST /api/job-sheet/lost-reasons");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = sheet ?? loaded.value;
  const checklist = current.checklists.find((each) => each.visit_type === kind);

  return (
    <Panel titleId="job-sheet" title={copy.title} className={styles.panel}>
      <div className={styles.group}>
        <Field label={copy.kind} className={styles.field}>
          {(control) => (
            <Select
              {...control}
              className={styles.select}
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
      </div>
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
          addLabel={copy.add}
          send={(items) => api.setChecklist(kind, items)}
          pick={(saved) => saved.checklists.find((each) => each.visit_type === kind) ?? checklist}
          onSaved={setSheet}
        />
      )}
      <Reasons
        id="partial-reasons"
        title={copy.reasons}
        list={current.partial_reasons}
        most={current.max_partial_reasons}
        mayChange={mayChangeReasons}
        send={(items) => api.setPartialReasons(items)}
        pick={(saved) => saved.partial_reasons}
        onSaved={setSheet}
        longest={current.max_label}
      />
      <Reasons
        id="lost-reasons"
        title={copy.lostReasons}
        list={current.lost_reasons}
        most={current.max_lost_reasons}
        mayChange={mayChangeLost}
        send={(items) => api.setLostReasons(items)}
        pick={(saved) => saved.lost_reasons}
        onSaved={setSheet}
        longest={current.max_label}
      />
    </Panel>
  );
}
