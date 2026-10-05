// A visit on the board cancelled, closed by hand, or its technician let in past the geofence, each in its own panel
// (./DispatchScreen.tsx), and what the board says once it has.

import type { Access } from "../lib/access.ts";
import { CancelVisit } from "../clients/CancelVisit.tsx";
import { CloseVisit } from "../clients/CloseVisit.tsx";
import { dispatch } from "../content.ts";
import { changeOf, idOf, nameOf, type BlockJob, type VisitChange } from "./job.ts";
import type { Notice } from "./landing.ts";
import { LetIn } from "./LetIn.tsx";

/** A visit being changed in its own panel. */
export interface Changing {
  readonly job: BlockJob;
  readonly change: VisitChange | "let_in";
}

/** The change a block's visit takes now, if the person's access reaches it. */
export function changeFor(job: BlockJob, access: Access): VisitChange | null {
  const change = changeOf(job.block, Date.now());
  if (change === "cancel" && access.mayCall("POST /api/visits/{id}/cancel")) return change;
  if (change === "close" && access.mayCall("POST /api/visits/{id}/close")) return change;
  return null;
}

/** What a cancel or a close by hand did, over the board once its panel closes. */
export function changedNotice(changing: Changing): Notice {
  const name = nameOf(changing.job);
  if (changing.change === "let_in") {
    return { tone: "done", text: dispatch.landing.letIn(changing.job.technician.name, name), call: null };
  }
  const text = changing.change === "cancel" ? dispatch.landing.cancelled(name) : dispatch.landing.closedByHand(name);
  return { tone: "done", text, call: null };
}

export function ChangePanel({ changing, onClose }: { changing: Changing; onClose: (changed: boolean) => void }) {
  const { job, change } = changing;
  const name = job.block.person?.name ?? nameOf(job);
  if (change === "let_in") return <LetIn visitId={idOf(job)} technician={job.technician.name} onClose={onClose} />;
  if (change === "cancel") return <CancelVisit visitId={idOf(job)} name={name} onClose={onClose} />;
  return <CloseVisit visitId={idOf(job)} name={name} date={job.date} onClose={onClose} />;
}
