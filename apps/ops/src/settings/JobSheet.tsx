// Settings, Job sheet (docs/decisions/0087-consumables-and-stock.md; docs/open-points.md, item 28):
// what the technician ticks on each kind of visit, and the reasons he may pick
// when a job is left partly done. The owner ruled on 27 September 2026 that
// both are set here and the technician app reads them with each job; a phone
// keeps the list it was given with the job, and an item taken off is kept, so
// what a phone recorded before the change is still understood.
//
// Until ops save a list, the committed one stands (src/config/job-sheet.ts),
// and the panel says so.

import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type JobSheet as Sheet, type VisitType } from "../api.ts";
import { dispatch, settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ListEditor, ListRead } from "./ListEditor.tsx";
import styles from "./settings.module.css";

const copy = settings.jobSheet;

const typeName = (type: string) => dispatch.typeNames[type] ?? type;

export function JobSheet() {
  const [loaded, retry] = useLoad(api.jobSheet);
  /** The sheet after a save, so "Set by" follows without reading it again. */
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [kind, setKind] = useState<VisitType>("service");
  const access = useAccess();
  const mayChangeChecklists = access.mayCall("POST /api/job-sheet/checklists/{visit_type}");
  const mayChangeReasons = access.mayCall("POST /api/job-sheet/partial-reasons");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;
  const current = sheet ?? loaded.value;
  const checklist = current.checklists.find((each) => each.visit_type === kind);

  return (
    <section className={styles.panel} aria-labelledby="job-sheet">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="job-sheet">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      <div className={styles.group}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="job-sheet-kind">
            {copy.kind}
          </label>
          <select
            className={styles.select}
            id="job-sheet-kind"
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
          </select>
        </div>
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
          onSave={(items) => api.setChecklist(kind, items)}
          pick={(saved) => saved.checklists.find((each) => each.visit_type === kind) ?? checklist}
          onSaved={setSheet}
        />
      )}
      <p className={styles.note}>{copy.reasonsNote}</p>
      {!mayChangeReasons && <ListRead title={copy.reasons} list={current.partial_reasons} />}
      {mayChangeReasons && (
        <ListEditor
          id="partial-reasons"
          title={copy.reasons}
          list={current.partial_reasons}
          most={current.max_partial_reasons}
          longest={current.max_label}
          itemLabel={copy.reason}
          addLabel={copy.addReason}
          onSave={(items) => api.setPartialReasons(items)}
          pick={(saved) => saved.partial_reasons}
          onSaved={setSheet}
        />
      )}
    </section>
  );
}
